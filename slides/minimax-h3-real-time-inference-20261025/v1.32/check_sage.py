import torch,json
from pathlib import Path
from vllm_omni.diffusion.attention.ops.block_sparse import block_sparse_attn_bshd,resolve_block_sparse_provider,split_tile128_map
r=Path(__file__).resolve().parent
torch.manual_seed(1234);torch.set_num_threads(4)
q,k,v=[torch.randn(1,512,2,128,device='cuda',dtype=torch.bfloat16) for _ in range(3)]
sizes=torch.tensor([128,81,128,35],device='cuda',dtype=torch.int32)
mask=torch.tensor([[1,1,0,0],[1,1,1,0],[1,0,1,1],[1,0,0,1]],device='cuda',dtype=torch.bool)[None,None].expand(1,2,4,4).contiguous()
mask64,sizes64=split_tile128_map(mask,sizes)
valid=torch.arange(512,device='cuda')%128<sizes.repeat_interleave(128)
exact=mask.repeat_interleave(128,-2).repeat_interleave(128,-1)&valid[None,None,None,:]
split=mask64.repeat_interleave(64,-2).repeat_interleave(64,-1)&(torch.arange(512,device='cuda')%64<sizes64.repeat_interleave(64))[None,None,None,:]
assert torch.equal(exact,split)
for x in [q,k,v]:x[:,~valid]=0
provider=resolve_block_sparse_provider('flashinfer','sage',q.device,q.dtype,128,128)
with torch.inference_mode():
 out=block_sparse_attn_bshd(q,k,v,mask,sizes,128**-.5,provider=provider,precision='sage',block_size=128)
 ref=torch.nn.functional.scaled_dot_product_attention(q.transpose(1,2),k.transpose(1,2),v.transpose(1,2),attn_mask=exact).transpose(1,2)
 a=out[:,valid].float().flatten();b=ref[:,valid].float().flatten()
 cosine=torch.nn.functional.cosine_similarity(a,b,dim=0).item();rmse=(a-b).square().mean().sqrt().item()
 assert torch.isfinite(out).all() and cosine>.99,(cosine,rmse)
report={'status':'pass','tile128_mask_exact_after_split':True,'ragged_sizes':sizes.tolist(),'head_dim':128,'heads':2,'sage_vs_sdpa_cosine':cosine,'sage_vs_sdpa_rmse':rmse,'provider':provider,'precision':'Q/K INT8 and V FP8; CAKE Sage fine attention; BF16 output','note':'A random ragged sparse-layout numerical smoke check, not a full-model quality guarantee.'}
(r/'sage-dispatch-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
