"""Pinned SpargeAttn Sage2 FP32-accumulator kernel with H3 valid-token masking.

The patch only adds per-KV-block valid lengths and uses PyTorch's current stream.
No Sparge selection or PV threshold pruning is used; FastVideo owns VSA selection.
"""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,difflib
import torch
from torch.utils.cpp_extension import load
root=Path(__file__).resolve().parents[1]/'omni-local-20261022'
source=root/'SpargeAttn';out=root/'sage2-deps';out.mkdir(exist_ok=True)
patched=root/'sage2-source';patched.mkdir(exist_ok=True)
shutil.copytree(source/'csrc',patched/'csrc',dirs_exist_ok=True)
header=patched/'csrc/qattn/qk_int_sv_f8_cuda_sm89.cuh'
original=header.read_text();text=original
# Both global and host dispatch signatures, and the dispatch call.
text=text.replace('float *__restrict__ PV_Threshold,','float *__restrict__ PV_Threshold, int32_t *__restrict__ KV_Valid,')
text=text.replace('    PV_Threshold,\n','    PV_Threshold,\n    KV_Valid,\n')
# Mask the current K tile BEFORE K_idx is advanced for the prefetch. Three
# conversion sites cover the body, penultimate and final loop iterations.
marker='    if constexpr (pv_threashold_mode != PVThresholdMode::kNone) // use pv_threshold'
assert text.count(marker)==1
mask='    apply_out_of_bound_mask<num_tiles_q, num_tiles_k>(K_idx_lane_base, RS_f32, (K_idx_lane_base / CTA_K) * CTA_K + KV_Valid[K_idx_lane_base / CTA_K]);\n\n'
text=text.replace(marker,mask+marker)
# The second-last iteration increments K_idx between causal mask and softmax.
marker='    K_idx_lane_base += KV_block_increm * CTA_K;\n\n    update_mdo'
assert text.count(marker)==1
text=text.replace(marker,mask+marker)
marker='    apply_out_of_bound_mask<num_tiles_q, num_tiles_k>(K_idx_lane_base, RS_f32, kv_len);'
assert text.count(marker)==1
text=text.replace(marker,marker+'\n'+mask)
text=text.replace('<<<grid, block, smem_max>>>','<<<grid, block, smem_max, at::cuda::getCurrentCUDAStream()>>>')
header.write_text(text)
(root/'sage2-h3-valid-token.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),text.splitlines(True),fromfile='upstream/qk_int_sv_f8_cuda_sm89.cuh',tofile='h3/qk_int_sv_f8_cuda_sm89.cuh')))
wrapper=patched/'sage2_h3.cu'
wrapper.write_text(r'''
#include <torch/extension.h>
#include <ATen/cuda/CUDAContext.h>
#include <c10/cuda/CUDAGuard.h>
#include <c10/cuda/CUDAException.h>
#include "csrc/qattn/qk_int_sv_f8_cuda_sm89.cuh"
void forward(torch::Tensor q,torch::Tensor k,torch::Tensor v,torch::Tensor o,
 torch::Tensor lut,torch::Tensor counts,torch::Tensor valid,
 torch::Tensor qs,torch::Tensor ks,torch::Tensor vs,double scale) {
 for(auto t:{q,k,v,o,lut,counts,valid,qs,ks,vs}) {
  TORCH_CHECK(t.is_cuda() && t.is_contiguous(),"CUDA contiguous tensors required");
  TORCH_CHECK(t.device()==q.device(),"device mismatch");
 }
 TORCH_CHECK(q.dim()==4 && k.sizes()==q.sizes() && o.sizes()==q.sizes(),"self attention HND shape required");
 TORCH_CHECK(q.scalar_type()==at::kChar && k.scalar_type()==at::kChar && o.scalar_type()==at::kBFloat16,"Q/K INT8 and output BF16 required");
 TORCH_CHECK(q.size(3)==128 && q.size(2)%128==0,"head128 and padded sequence required");
 TORCH_CHECK(lut.scalar_type()==at::kInt && counts.scalar_type()==at::kInt && valid.scalar_type()==at::kInt,"INT32 masks required");
 TORCH_CHECK(valid.numel()==k.size(2)/64,"one valid length per KV tile required");
 TORCH_CHECK(lut.dim()==4 && lut.size(0)==q.size(0) && lut.size(1)==q.size(1) && lut.size(2)==q.size(2)/128 && lut.size(3)==k.size(2)/64,"LUT shape mismatch");
 TORCH_CHECK(counts.numel()==q.size(0)*q.size(1)*q.size(2)/128,"count shape mismatch");
 TORCH_CHECK(v.scalar_type()==at::kFloat8_e4m3fn && v.size(0)==q.size(0) && v.size(1)==q.size(1) && v.size(2)==128 && v.size(3)==q.size(2),"V layout mismatch");
 c10::cuda::CUDAGuard guard(q.device());
 SpargeAttentionSM89Dispatched<128,64,32,64,128,1,float,true,false,0,nv_bfloat16,false,true,false>(
 q.data_ptr<int8_t>(),k.data_ptr<int8_t>(),reinterpret_cast<__nv_fp8_e4m3*>(v.data_ptr()),reinterpret_cast<nv_bfloat16*>(o.data_ptr()),
 nullptr,lut.data_ptr<int32_t>(),counts.data_ptr<int32_t>(),nullptr,valid.data_ptr<int32_t>(),
 qs.data_ptr<float>(),ks.data_ptr<float>(),vs.data_ptr<float>(),
 q.size(0),q.size(2),k.size(2),q.size(1),k.size(1),
 q.stride(0),q.stride(2),q.stride(1),k.stride(0),k.stride(2),k.stride(1),
 v.stride(0),v.stride(1),v.stride(2),o.stride(0),o.stride(2),o.stride(1),scale);
 C10_CUDA_KERNEL_LAUNCH_CHECK();
}
PYBIND11_MODULE(TORCH_EXTENSION_NAME,m){m.def("forward",&forward);}
''')
fused_source=patched/'csrc/fused/fused.cu'
fused_original=fused_source.read_text()
fused_text='#include <ATen/cuda/CUDAContext.h>\n'+fused_original.replace('<<<grid, block>>>','<<<grid, block, 0, at::cuda::getCurrentCUDAStream()>>>')
fused_source.write_text(fused_text)
with (root/'sage2-h3-valid-token.patch').open('a') as f:f.write(''.join(difflib.unified_diff(fused_original.splitlines(True),fused_text.splitlines(True),fromfile='upstream/fused.cu',tofile='h3/fused.cu')))
flags=['-O3','-std=c++17','-U__CUDA_NO_HALF_OPERATORS__','-U__CUDA_NO_HALF_CONVERSIONS__','-U__CUDA_NO_BFLOAT16_OPERATORS__','-U__CUDA_NO_BFLOAT16_CONVERSIONS__','--use_fast_math','--expt-relaxed-constexpr','-include','cassert','-gencode=arch=compute_120a,code=sm_120a']
records=[]
for name,files in [('sage2_h3_cuda',[wrapper]),('sage2_fused_cuda',[patched/'csrc/fused/pybind.cpp',fused_source])]:
 build=root/('build-'+name);build.mkdir(exist_ok=True)
 module=load(name,sources=list(map(str,files)),extra_cflags=['-O3','-std=c++17'],extra_cuda_cflags=flags,build_directory=str(build),verbose=True)
 target=out/Path(module.__file__).name;shutil.copy2(module.__file__,target)
 records.append({'name':name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
shutil.copy2(source/'spas_sage_attn/utils.py',out/'sage2_upstream_utils.py')
shutil.copy2(source/'LICENSE',out/'LICENSE-SpargeAttn')
(root/'sage2-build.json').write_text(json.dumps({'state':'complete','torch':torch.__version__,'cuda':torch.version.cuda,'arch':'sm_120a','source_revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip(),'patch_sha256':hashlib.sha256((root/'sage2-h3-valid-token.patch').read_bytes()).hexdigest(),'flags':flags,'extensions':records,'accumulation':'FP32 instruction buffer (SageAttention2, not Sage2++)','selection':'FastVideo VSA mask; no Sparge selection, no PV threshold pruning','adaptation':'Internal padded KV rows masked before every online softmax update; current CUDA stream'},indent=2)+'\n')
