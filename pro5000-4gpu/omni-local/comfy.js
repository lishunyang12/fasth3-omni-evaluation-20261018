/* Current-policy data stays separate from historical article-canvas results. */
(()=>{
 'use strict';
 const r=window.REPORT,el=id=>document.getElementById(id),escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const seconds=x=>Number.isFinite(x)?(x/1000).toFixed(2):'—';
 const labels={resident:'GPU resident',module:'Module CPU offload',layerwise:'Layerwise · DiT + encoder','dit-layerwise':'Layerwise · DiT only'};
 const names={image:'1 image','image-voice':'Image + voice',images3:'3 images',clip:'Short video',video:'Long video'};
 const rows=[...(r.comfy_runs||[]),...(r.comfy_matched_runs||[])],cases=r.comfy_plan?.cases||[];
 const summary=(run,key)=>[...(run?.summaries||[]),...(run?.speed_summaries||[])].find(x=>x.key===key);
 function status(run,key){
  if(summary(run,key))return 'Complete · 3/3 seeds';
  const failure=run?.failures?.find(f=>f.key===key);if(failure)return failure.kind==='cuda_oom'?'OOM':'Failed';
  if(run?.current===key){if(run.state==='starting')return 'Loading model';if(run.active_request?.phase==='warmup')return 'Warmup in progress';return 'Measuring';}
  return 'Queued';
 }
 const peak=m=>Number.isFinite(m?.memory?.max_per_gpu_gib)?m.memory.max_per_gpu_gib.toFixed(2):'—';
 const evidence=(run,key)=>(run?.media?.[key]?`<a href="${escape(run.media[key])}">Seed 0 MP4 ↗</a>`:'')+(run?.config_url?` <a href="${escape(run.config_url)}" download>Config ↓</a>`:'');
 function render(){
  const key=el('comfy-workload').value+'|480p';
  const get=mode=>rows.find(x=>x.id===`pro5000-1gpu-36l${mode==='resident'?'':'-'+mode+'-offload'}-comfy-refs`);
  const reference=get('resident'),base=summary(reference,key);
  el('comfy-offload-table').tBodies[0].innerHTML=Object.keys(labels).map(mode=>{
   const run=get(mode),m=summary(run,key),keys=[key,key+'|seed1',key+'|seed2'];
   const pairs=keys.filter(k=>run?.output_hashes?.[k]&&reference?.output_hashes?.[k]);
   const equality=mode==='resident'?'Reference':pairs.length===3?`${pairs.filter(k=>run.output_hashes[k]===reference.output_hashes[k]).length}/3 byte-identical`:'Awaiting outputs';
   return `<tr data-mode="${mode}"><th>${labels[mode]}</th><td>${status(run,key)}</td><td>${seconds(m?.e2e_ms.mean)}</td><td>${seconds(m?.dit_ms.mean)}</td><td>${peak(m)}</td><td>${m&&base?(m.e2e_ms.mean/base.e2e_ms.mean).toFixed(3)+'×':'—'}</td><td>${equality}</td><td>${evidence(run,key)}</td></tr>`;
  }).join('');
 }
 const audit=r.comfy_audit;
 if(audit?.images)el('comfy-audit-summary').textContent=`Validated ${audit.dimension_parity.image_cases.toLocaleString('en-US')} image and ${audit.dimension_parity.video_cases.toLocaleString('en-US')} video dimension cases. Three-image effective sequence: ${audit.images['480p'].effective_sequence_length.toLocaleString('en-US')} tokens at 480p; ${audit.images['768p'].effective_sequence_length.toLocaleString('en-US')} at 768p. Short reference: ${audit.videos.find(x=>x.workload==='clip').vae_frames} VAE frames; long reference: ${audit.videos.find(x=>x.workload==='video').vae_frames}.`;
 const matrix=cases.flatMap(c=>c.key?[c]:['image','image-voice','images3','clip','video'].map(w=>({...c,key:w+'|480p'})));
 el('comfy-matrix').tBodies[0].innerHTML=matrix.map(c=>{
  const run=rows.find(x=>x.id===c.id),m=summary(run,c.key),[w,res]=c.key.split('|');
  return `<tr><th>${escape(c.id)}</th><td>${names[w]}</td><td>${res}</td><td>${status(run,c.key)}</td><td>${seconds(m?.e2e_ms.mean)}</td><td>${peak(m)}</td><td>${evidence(run,c.key)}</td></tr>`;
 }).join('');
 const done=matrix.filter(c=>summary(rows.find(x=>x.id===c.id),c.key)).length;
 el('comfy-progress').textContent=`${done} / ${matrix.length} current configurations measured. ${r.comfy_status?.current?'Running: '+r.comfy_status.current:r.comfy_status?.state||'Preparing'}. Each measured row requires seeds 0/1/2 after warmup.`;
 el('comfy-workload').addEventListener('change',render);render();
})();
