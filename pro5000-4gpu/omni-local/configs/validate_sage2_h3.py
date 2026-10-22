"""Test H3 internal padding, sparse selections, loop paths and CUDA streams."""
from pathlib import Path
import json,time
import torch
import torch.nn.functional as F
from sage2_fastvideo import attention
root=Path(__file__).resolve().parents[1]/'omni-local-20261022'
assert torch.cuda.device_count()==1
assert torch.cuda.get_device_capability()==(12,0)
torch.manual_seed(987);records=[]
for label,sizes_list,pattern in [('single_k',[31],None),('two_k',[97],None),('many_k',[128,37,0,97,8,128],None),('sparse_ragged',[128,37,0,97,8,128],'sparse')]:
 sizes=torch.tensor(sizes_list,device='cuda',dtype=torch.int32);nt=len(sizes_list);n=nt*128;b,h=2,3
 q,k,v=[torch.randn(b,n,h,128,device='cuda',dtype=torch.bfloat16) for _ in range(3)]
 valid=(torch.arange(128,device='cuda')[None,:]<sizes[:,None]).flatten()
 mask=torch.ones(b,h,nt,nt,device='cuda',dtype=torch.bool)
 if pattern:
  mask=torch.rand(b,h,nt,nt,device='cuda')>.5;mask[:,:,:,0]=True;mask[:,:,2,:]=False
 dense=mask.repeat_interleave(128,dim=-2).repeat_interleave(128,dim=-1)&valid[None,None,None,:]
 ref=F.scaled_dot_product_attention(q.transpose(1,2).float(),k.transpose(1,2).float(),v.transpose(1,2).float(),attn_mask=dense).transpose(1,2)
 got=attention(q,k,v,mask,sizes).float();torch.cuda.synchronize()
 assert torch.isfinite(got).all(),label
 a=got[:,valid].flatten();r=ref[:,valid].flatten()
 cosine=F.cosine_similarity(a,r,dim=0).item();relative_rmse=((a-r).square().mean()/r.square().mean()).sqrt().item()
 assert cosine>.99 and relative_rmse<.12,(label,cosine,relative_rmse)
 records.append({'case':label,'cosine':cosine,'relative_rmse':relative_rmse,'passed':True})
# Poison padding V while keeping valid V constant. If padding enters softmax,
# the result is far above one; catches internal as well as final partial tiles.
sizes=torch.tensor([17,91,128,5],device='cuda',dtype=torch.int32);n=512
valid=(torch.arange(128,device='cuda')[None,:]<sizes[:,None]).flatten()
for nondefault in [False,True]:
 stream=torch.cuda.Stream() if nondefault else torch.cuda.current_stream()
 stream.wait_stream(torch.cuda.current_stream())
 with torch.cuda.stream(stream):
  q,k=[torch.randn(1,n,2,128,device='cuda',dtype=torch.bfloat16)*.3 for _ in range(2)]
  v=torch.ones_like(q);v[:,~valid]=10
  mask=torch.ones(1,2,4,4,device='cuda',dtype=torch.bool)
  got=attention(q,k,v,mask,sizes)
 stream.synchronize()
 error=(got[:,valid].float()-1).abs().max().item()
 assert error<.1,('padding leak',nondefault,error)
 records.append({'case':'poisoned_internal_padding','nondefault_stream':nondefault,'max_error_from_one':error,'passed':True})
result={'state':'passed','time':time.time(),'device':torch.cuda.get_device_name(),'cases':records,'scope':'Kernel correctness on synthetic masks; not a perceptual video quality score.'}
(root/'sage2-validation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
