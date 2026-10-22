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
  if(run?.current===key&&['starting','measuring'].includes(run.state)){if(run.state==='starting')return 'Loading model';if(run.active_request?.phase==='warmup')return 'Warmup in progress';return 'Measuring';}
  const failure=run?.failures?.filter(f=>f.key===key).at(-1);if(failure)return failure.kind==='cuda_oom'?'OOM':failure.classification==='harness_log_validation'?'Validation retry queued':'Failed';
  return 'Queued';
 }
 const peak=m=>Number.isFinite(m?.memory?.max_per_gpu_gib)?m.memory.max_per_gpu_gib.toFixed(2):'—';
 const evidence=(run,key)=>(run?.media?.[key]?`<a href="${escape(run.media[key])}">Seed 0 MP4 ↗</a>`:'')+(run?.config_url?` <a href="${escape(run.config_url)}" download>Config ↓</a>`:'');
 function render(){
  const key=el('comfy-workload').value+'|480p';
  const get=mode=>rows.find(x=>x.id===`pro5000-1gpu-36l${mode==='resident'?'':'-'+mode+'-offload'}-comfy-refs`);
  const reference=get('resident'),base=summary(reference,key),module=get('module');
  el('comfy-offload-table').tBodies[0].innerHTML=Object.keys(labels).map(mode=>{
   const run=get(mode),m=summary(run,key),keys=[key,key+'|seed1',key+'|seed2'];
   const pairs=keys.filter(k=>run?.output_hashes?.[k]&&reference?.output_hashes?.[k]);
   const equality=mode==='resident'?'Reference':pairs.length===3?`${pairs.filter(k=>run.output_hashes[k]===reference.output_hashes[k]).length}/3 byte-identical`:'Awaiting outputs';
   const modulePairs=keys.filter(k=>run?.output_hashes?.[k]&&module?.output_hashes?.[k]);
   const moduleEquality=mode==='module'?'Reference':modulePairs.length===3?`${modulePairs.filter(k=>run.output_hashes[k]===module.output_hashes[k]).length}/3 byte-identical`:'Awaiting outputs';
   return `<tr data-mode="${mode}"><th>${labels[mode]}</th><td>${status(run,key)}</td><td>${seconds(m?.e2e_ms.mean)}</td><td>${seconds(m?.dit_ms.mean)}</td><td>${peak(m)}</td><td>${m&&base?(m.e2e_ms.mean/base.e2e_ms.mean).toFixed(3)+'×':'—'}</td><td>${equality}</td><td>${moduleEquality}</td><td>${evidence(run,key)}</td></tr>`;
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
 const retryCases=matrix.filter(c=>rows.find(x=>x.id===c.id)?.failures?.some(f=>f.key===c.key&&f.classification==='harness_log_validation'));
 const pendingRetries=retryCases.filter(c=>!summary(rows.find(x=>x.id===c.id),c.key));
 if(retryCases.length)el('comfy-retry-note').textContent=`${retryCases.length} multi-GPU three-image warmups completed but their log-based validation failed because worker INFO logs were suppressed. Their failures are preserved. ${pendingRetries.length} retests using per-rank runtime evidence remain; ${retryCases.length-pendingRetries.length} have completed.`;
 const profile=r.offload_overlap_profile;
 if(profile?.state==='complete'){
  el('comfy-overlap').hidden=false;
  el('comfy-overlap-summary').textContent=`${(profile.h2d_overlap_fraction*100).toFixed(2)}% of H2D copy-active time overlaps GPU kernels: ${profile.h2d_overlapping_kernels_s.toFixed(3)} / ${profile.h2d_active_s.toFixed(3)} s, with ${(profile.h2d_not_overlapping_kernels_s*1000).toFixed(1)} ms outside kernels. Measured during one warmed-up, three-image 480p DiT request with DiT-only layerwise offload. The profiled MP4 matches the unprofiled seed 0 file byte for byte.`;
  const svg=el('comfy-overlap-chart'),ns='http://www.w3.org/2000/svg';
  const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.appendChild(n);return n;};
  add('title',{},'First 250 milliseconds of measured H2D transfers and GPU kernels');
  for(const [label,key,y,color] of [['GPU kernels','kernel_intervals_ms',26,'#147851'],['H2D copies','h2d_intervals_ms',64,'#7560a0']]){
   add('text',{x:0,y:y+13,fill:'currentColor','font-size':13},label);
   add('rect',{x:110,y,width:640,height:19,fill:'currentColor',opacity:0.07});
   for(const [a,b] of profile.first_250ms[key]){const n=add('rect',{x:110+a*2.56,y,width:Math.max(0.2,(b-a)*2.56),height:19,fill:color});const t=document.createElementNS(ns,'title');t.textContent=`${label}: ${a.toFixed(3)}–${b.toFixed(3)} ms`;n.appendChild(t);}
  }
  for(const ms of [0,50,100,150,200,250])add('text',{x:110+ms*2.56,y:107,'text-anchor':ms===250?'end':'start',fill:'currentColor','font-size':12},ms+' ms');
 }
 el('comfy-workload').addEventListener('change',render);render();
})();
