"""FastVideo VSA selection + pinned SpargeAttn SageAttention2 fine kernel.

H3 has internal padded tile rows. The local CUDA patch masks those KV rows in
all online-softmax iterations. Query padding is removed by the H3 caller.
"""
from pathlib import Path
import hashlib,json,os
import torch
import sage2_h3_cuda as kernel
import sage2_fused_cuda as fused
from sage2_upstream_utils import get_vanilla_qk_quant,block_map_lut_triton


def attention(q,k,v,block_map,sizes):
    assert q.shape==k.shape==v.shape and q.shape[-1]==128 and q.dtype==torch.bfloat16
    assert block_map.shape[-2:]==(sizes.numel(),sizes.numel()) and q.shape[1]==sizes.numel()*128
    sizes64=torch.stack((sizes.clamp(0,64),(sizes-64).clamp(0,64)),dim=-1).reshape(-1).to(torch.int32).contiguous()
    mask=block_map.repeat_interleave(2,dim=-1).bool() & (sizes64>0)[None,None,None,:]
    mask=mask.contiguous()
    qh,kh,vh=(x.transpose(1,2).contiguous() for x in (q,k,v))
    qi,qs,ki,ks=get_vanilla_qk_quant(qh,kh,kh.mean(dim=-2,keepdim=True),128,64)
    lut,counts=block_map_lut_triton(mask)
    vh=vh.to(torch.float16);b,h,n,d=vh.shape
    vt=torch.empty((b,h,d,n),device=v.device,dtype=torch.float16)
    vf=torch.empty_like(vt,dtype=torch.float8_e4m3fn)
    vs=torch.empty((b,h,d),device=v.device,dtype=torch.float32)
    fused.transpose_pad_permute_cuda(vh,vt,1)
    fused.scale_fuse_quant_cuda(vt,vf,vs,n,2.25,1)
    # Empty selection rows are defined as zero (upstream kernel returns early).
    out=torch.zeros_like(qh)
    kernel.forward(qi,ki,vf,out,lut,counts,sizes64,qs,ks,vs,d**-.5)
    return out.transpose(1,2).contiguous()


def install():
    from fastvideo.attention.backends import video_sparse_attn_h3 as h3
    root=Path(__file__).resolve().parents[1]/'omni-local-20261022'
    build=json.loads((root/'sage2-build.json').read_text())
    assert build['state']=='complete'
    assert json.loads((root/'sage2-validation.json').read_text())['state']=='passed'
    dest=Path(os.environ['FASTH3_ATTENTION_EVIDENCE']);dest.mkdir(parents=True,exist_ok=True)
    calls=0
    def fine(q,k,v,mask,metadata):
        nonlocal calls
        assert metadata.tile_elems==128
        sizes=metadata.variable_block_sizes
        out=attention(q,k,v,mask,sizes)
        if calls==0:
            assert bool(torch.isfinite(out).all()),'Nonfinite Sage2 warmup'
            rank=torch.distributed.get_rank() if torch.distributed.is_initialized() else 0
            evidence={'rank':rank,'backend':'vsa-sage2','shape':list(q.shape),'finite_first_warmup_output':True,
                'framework':'FastVideo native HTTP server','entry_point':'sage2_h3_cuda.forward',
                'logical_tile':128,'compute_q_tile':128,'compute_k_tile':64,'precision':'INT8 Q/K; FP8 E4M3 V; FP32 accumulation with instruction buffer',
                'q_quantization_block':128,'k_quantization_block':64,'v_quantization':'per-channel, scale_max=2.25 (pinned SpargeAttn recipe)',
                'pv_threshold_pruning':False,'smooth_k':True,'valid_token_mask':True,
                'partial_logical_tiles':int(((sizes>0)&(sizes<128)).sum()),'valid_tokens':int(sizes.sum()),
                'source_revision':build['source_revision'],'build':build,
                'adapter_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
            (dest/f'rank-{rank}.json').write_text(json.dumps(evidence,indent=2)+'\n')
            print(f'SageAttention2 H3 adapter verified on rank {rank}: {tuple(q.shape)}',flush=True)
        calls+=1
        return out
    h3.fine_attention_from_env=lambda:fine
