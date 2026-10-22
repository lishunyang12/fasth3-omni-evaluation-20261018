'use strict';
const R=window.REPORT,$=id=>document.getElementById(id);
const names={image:'1 image','image-voice':'Image + voice',images3:'3 images',clip:'1 short clip',video:'1 long clip'};
const source='https://haoailab.com/blogs/fasth3-omni-local/';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const s=ms=>Number.isFinite(ms)?(ms/1000).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const shortTime=secs=>Number.isFinite(secs)?(secs>=180?(secs/60).toFixed(1)+' min':secs.toFixed(1)+' s'):'Not reported';
const state={gallery:'image',galleryComparison:'machines',gallerySeed:0,galleryGpu:4,workload:'image',resolution:'480p',decoder:'36l',stageGpu:4};
const query=new URLSearchParams(location.search);
for(const [key,allowed] of Object.entries({workload:Object.keys(names),resolution:['480p','768p'],decoder:['36l','8l']}))if(allowed.includes(query.get(key)))state[key]=query.get(key);
const run=(g,d)=>R.runs.find(x=>x.id===`pro5000-${g}gpu-${d}`);
const result=(g,d,w=state.workload,res=state.resolution)=>run(g,d)?.summaries?.find(x=>x.key===`${w}|${res}`);
const offloadRun=(d,strategy='module')=>R.offload_runs?.find(x=>x.id===`pro5000-1gpu-${d}-${strategy}-offload`);
const offloadResult=(d,w=state.workload,res=state.resolution,strategy='module')=>offloadRun(d,strategy)?.summaries?.find(x=>x.key===`${w}|${res}`);
const offloadRecord=(d,w=state.workload,res=state.resolution,strategy='module')=>R.offload_records?.find(x=>x.decoder===d&&x.key===`${w}|${res}`&&x.strategy===strategy);
function offloadState(d,w=state.workload,res=state.resolution,strategy='module'){
 const r=offloadRecord(d,w,res,strategy);
 if(!r)return 'Not tested';
 return ({success:'Success · 3/3 seeds',oom:'Still OOM',failed:'Failed',loading:'Loading model',warmup:'Warmup in progress',measuring:`Measuring · ${r.measured_seeds.length}/3 seeds complete`,queued:'Queued · not started',superseded:'Superseded · ComfyUI study'})[r.after]||r.after;
}
function offloadPeak(r){
 if(!r?.memory)return ['queued','superseded'].includes(r?.after)?'Peak not measured':'Peak available after request completes';
 const prefix={measured_requests:'Sampled peak',partial_measured_requests:'Partial measured peak',warmup:'Warmup peak',failed_request:'Failed-request peak'}[r.memory_scope]||'Sampled peak';
 return `${prefix} ${gib(r.memory)} GiB`;
}
function articleStatus(device,w,res,d){
 // The source gives a profile-level capacity statement, not a full OOM matrix.
 return res==='480p'&&d==='36l'&&R.article_memory_evidence?.reported_limit?.devices.includes(device)&&R.article_memory_evidence.reported_limit.workloads.includes(w)?'Memory limit · article profile':'Not reported';
}
const statusName=x=>({complete:'Complete',failed:'Incomplete',needs_attention:'Some runs need attention',starting:'Loading model',measuring:'Measuring',pending:'Pending',benchmarking:'Measuring',generating:'Generating comparison videos',waiting_for_resources:'Waiting for available GPUs',running:'Measurements in progress',waiting_for_checkpoint_study:'BF16 / QAD study in progress',running_4gpu:'4-GPU matrix in progress',running_1gpu:'1-GPU matrix in progress'}[x]||'In progress');
const pending=(g,d,w=state.workload,res=state.resolution)=>{const r=run(g,d),key=`${w}|${res}`,failure=r?.failures?.find(x=>x.key===key);return failure?.kind==='cuda_oom'?'OOM':failure?'Failed':r?.state==='failed'?'Not yet tested':r?.current===key?'Measuring':'Pending'};
const trialTitle=x=>x?`Three runs: ${x.e2e_ms.values.map(v=>s(v)+' s').join(' / ')}. Mean ${s(x.e2e_ms.mean)} s; range ${s(x.e2e_ms.min)}–${s(x.e2e_ms.max)} s.`:'';
const gib=m=>Number.isFinite(m?.max_per_gpu_gib)?m.max_per_gpu_gib.toFixed(2):'—';
const memTitle=m=>m?Object.entries(m.per_gpu_mib||{}).map(([g,v])=>`GPU ${g}: ${(v/1024).toFixed(2)} GiB`).join('; ')+(m.peak_total_gib!==undefined?`; peak simultaneous total: ${m.peak_total_gib.toFixed(2)} GiB`:''):'No request-bounded samples';
function memoryFor(r,key){
 const summary=[...(r?.summaries||[]),...(r?.speed_summaries||[])].find(x=>x.key===key);
 if(summary?.memory)return summary.memory;
 const rows=(r?.request_memory||[]).filter(x=>x.workload+'|'+x.resolution===key&&x.memory);
 const measured=rows.filter(x=>x.status==='complete'&&['measured','qualitative'].includes(x.phase));
 return measured.length?measured.reduce((a,b)=>a.memory.max_per_gpu_gib>b.memory.max_per_gpu_gib?a:b).memory:rows.filter(x=>x.status!=='complete').at(-1)?.memory;
}
let player=null;
function videoCard({title,meta,url,poster,pro=false,key}){return `<div class="video-card ${pro?'pro-card':''}" data-key="${esc(key||title)}"><h4>${esc(title)}</h4><p class="video-meta">${esc(meta)}</p>${url?`<div class="gallery-viewport"><video controls muted playsinline preload="${pro?'metadata':'none'}" ${poster?`poster="${esc(poster)}"`:''} src="${esc(url)}" aria-label="${esc(title)}"></video></div><a class="download" href="${esc(url)}" download>Download original MP4</a>`:'<div class="empty-video"><strong>Awaiting measured output</strong><span>Published after this request completes.</span></div><span class="download">Not available yet</span>'}</div>`;}
function checkpointCard(c,seed=0){
 const r=(R.matched_checkpoint_runs||[]).find(x=>x.case===c),key=state.gallery+'|480p',mediaKey=key+(seed?'|seed'+seed:'');
 const sample=r?.quality_samples?.find(x=>x.workload===state.gallery&&x.seed===seed),m=r?.speed_summaries?.find(x=>x.key===key);
 const timing=m?s(m.e2e_ms.mean)+' s · three-seed mean':sample?s(sample.e2e_ms)+' s · single sample; timing study pending':r?.current===key?'Generating':r?.state==='failed'?'Generation failed':'Queued';
 const title='4× PRO 5000 · '+(c==='bf16'?'Original BF16 weights':'QAD NVFP4');
 const weights=c==='bf16'?'BF16 DiT + text-encoder weights':'NVFP4 QAD DiT + text-encoder linear weights';
 const card=videoCard({title,meta:`${weights} · Original VAE (FP16 decode) · CAKE fine attention: INT8 Q/K + FP8 V · vLLM-Omni · seed ${seed} · ${timing} · peak ${gib(sample?.memory)} GiB/GPU`,url:r?.media?.[mediaKey],pro:true,key:'matched-'+c});
 const model=c==='bf16'?'FastVideo-FastH3-Omni-8-Step-V1':'FastH3-Omni-NVFP4-QAD';
 const checkpoint=`<a class="download" href="https://huggingface.co/FastVideo/${model}">${esc(model)} ↗</a>`;
 const revision=r?.checkpoint_revision?`<span class="download">Revision <code>${esc(r.checkpoint_revision.slice(0,12))}</code></span>`:'';
 return card.slice(0,-6)+checkpoint+revision+(r?.config_url?'<a class="download" href="'+esc(r.config_url)+'" download>Server config YAML</a>':'')+'</div>';
}
function attachPlayer(){
 player?.dispose();
 const videos=[...document.querySelectorAll('#source-videos video,#pro-videos video,#matched-checkpoint-videos video,#matched-decoder-videos video')];
 const hosts=[...document.querySelectorAll('#source-videos,#pro-videos,#matched-checkpoint-videos,#matched-decoder-videos')];
 hosts.forEach(h=>h.classList.remove('gallery-zoom'));
 const titles=videos.map(v=>v.closest('.video-card').querySelector('h4').textContent),status=$('gallery-status');
 $('gallery-player').innerHTML=`<button id="play-all" type="button">Play together</button><button id="pause-all" type="button">Pause all</button><button id="gallery-prev" type="button" aria-label="Previous frame">← Frame</button><button id="gallery-next" type="button" aria-label="Next frame">Frame →</button><label>Listen to <select id="gallery-audio"><option value="-1">Mute all</option>${titles.map((t,i)=>`<option value="${i}">${esc(t)}</option>`).join('')}</select></label><label>Detail <select id="gallery-zoom"><option value="1">Full frame</option><option value="2">2× center crop</option></select></label><input id="gallery-timeline" aria-label="Video frame" type="range" min="0" max="123" step="1" value="0"><span class="time">Frame 0 / 123 · 0.00 s</span>`;
 const button=$('play-all'),timeline=$('gallery-timeline'),clock=$('gallery-player').querySelector('.time');
 let playing=false,disposed=false,timer=null,frame=0,operation=0;const waits=new Set();
 const update=f=>{frame=Math.max(0,Math.min(123,f));timeline.value=frame;clock.textContent=`Frame ${frame} / 123 · ${(frame/24).toFixed(2)} s`;};
 const pause=()=>{operation++;playing=false;videos.forEach(v=>v.pause());if(timer)cancelAnimationFrame(timer);timer=null;};
 const ready=(v,need=2,at=null)=>{
  const isReady=()=>v.readyState>=need&&(at===null||(!v.seeking&&Math.abs(v.currentTime-at)<.02));
  if(isReady())return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const events=['loadedmetadata','loadeddata','canplay','seeked','progress'];
   const clean=()=>{clearTimeout(timeout);clearInterval(poll);events.forEach(e=>v.removeEventListener(e,check));v.removeEventListener('error',fail);waits.delete(cancel)};
   const check=()=>{if(isReady()){clean();resolve()}},fail=()=>{clean();reject(Error('A video could not load. Retry or open its original MP4.'))},cancel=()=>{clean();reject(Error('Selection changed'))};
   const timeout=setTimeout(()=>{clean();reject(Error('Video loading timed out. Retry or open its original MP4.'))},40000),poll=setInterval(check,100);
   events.forEach(e=>v.addEventListener(e,check));v.addEventListener('error',fail,{once:true});waits.add(cancel);v.preload='auto';check();
  });
 };
 const seekFrame=async f=>{
  if(!videos.length)return;pause();update(f);const token=operation,target=(frame+.05)/24;status.textContent=`Loading frame ${frame}…`;
  try{await Promise.all(videos.map(v=>ready(v,1)));if(disposed||token!==operation)return;videos.forEach(v=>v.currentTime=target);await Promise.all(videos.map(v=>ready(v,2,target)));if(disposed||token!==operation)return;status.textContent=`Paused at frame ${frame}. Compare identity, texture, edges and temporal consistency.`}catch(e){if(!disposed&&token===operation)status.textContent=e.message}
 };
 const seek=seconds=>seekFrame(Math.round(seconds*24));
 const tick=()=>{if(!playing||disposed)return;const lead=videos[0];if(lead.ended){pause();update(123);return}update(Math.floor(lead.currentTime*24));for(const v of videos.slice(1))if(v.readyState>=2&&Math.abs(v.currentTime-lead.currentTime)>.08)v.currentTime=lead.currentTime;timer=requestAnimationFrame(tick);};
 const play=async()=>{
  if(!videos.length)return;pause();const token=operation;button.disabled=true;status.textContent='Loading selected videos…';
  try{await Promise.all(videos.map(v=>ready(v)));if(disposed||token!==operation)return;if(frame>=123)update(0);videos.forEach(v=>v.currentTime=(frame+.05)/24);await Promise.all(videos.map(v=>v.play()));if(disposed||token!==operation){videos.forEach(v=>v.pause());return}playing=true;status.textContent='Playing matched outputs. Pause or step through frames to inspect detail.';tick()}catch(e){pause();if(!disposed)status.textContent=e.message}finally{if(!disposed)button.disabled=!videos.length}
 };
 button.onclick=play;$('pause-all').onclick=pause;timeline.oninput=()=>seekFrame(Number(timeline.value));$('gallery-prev').onclick=()=>seekFrame(frame-1);$('gallery-next').onclick=()=>seekFrame(frame+1);
 $('gallery-audio').onchange=e=>videos.forEach((v,i)=>v.muted=i!==Number(e.target.value));
 $('gallery-zoom').onchange=e=>hosts.forEach(h=>h.classList.toggle('gallery-zoom',e.target.value==='2'));
 videos.forEach(v=>v.addEventListener('ended',()=>{pause();update(123)}));
 for(const id of ['play-all','pause-all','gallery-prev','gallery-next','gallery-timeline'])$(id).disabled=!videos.length;
 player={play,pause,seek,seekFrame,videos,dispose(){disposed=true;pause();[...waits].forEach(cancel=>cancel());videos.forEach(v=>{v.removeAttribute('src');v.load()})}};
}
function renderGallery(){
 player?.dispose();
 const w=R.workloads.find(x=>x.id===state.gallery),key=state.gallery+'|480p';
 const checkpointView=state.galleryComparison==='checkpoints';
 $('matched-checkpoint-panel').hidden=!checkpointView;
 $('gallery-pro-heading').hidden=checkpointView;
 $('gallery-bf16-note').hidden=checkpointView;
 $('gallery-gpu').closest('label').hidden=checkpointView;
 $('gallery-seed-label').hidden=!checkpointView;
 if(checkpointView){
  $('source-videos').innerHTML='';$('pro-videos').innerHTML='';
  const rows=(R.matched_checkpoint_runs||[]),mediaKey=key+(state.gallerySeed?'|seed'+state.gallerySeed:'');
  const summary=c=>rows.find(x=>x.case===c)?.speed_summaries?.find(x=>x.key===key);
  $('matched-checkpoint-videos').innerHTML=['bf16','qad'].map(c=>checkpointCard(c,state.gallerySeed)).join('');
  const ready=rows.filter(r=>r.media?.[mediaKey]).length;
  $('matched-checkpoint-status').textContent=`${ready} / 2 outputs ready for ${names[state.gallery]}, seed ${state.gallerySeed}. ${R.matched_checkpoint_outputs||0} / 30 checkpoint outputs across five reference mixes and three seeds. ${R.matched_checkpoint_status?.state==='waiting_for_resources'?'Waiting for four available GPUs.':''}`;
  const stages=[['e2e_ms','End to end'],['encode_prompt_ms','Prompt encoding'],['reference_encode_ms','Reference encoding'],['dit_ms','DiT denoising'],['video_vae_ms','Video decoding']];
  $('matched-speed-table').tBodies[0].innerHTML=stages.map(([field,label])=>`<tr><th>${label}</th>${['bf16','qad'].map(c=>`<td>${summary(c)?s(summary(c)[field]?.mean):'Awaiting 3 samples'}</td>`).join('')}</tr>`).join('');
  $('matched-speed-table').tBodies[0].insertAdjacentHTML('beforeend','<tr><th>Peak / GPU · GiB</th>'+['bf16','qad'].map(c=>{const m=memoryFor(rows.find(x=>x.case===c),key);return `<td title="${esc(memTitle(m))}">${gib(m)}</td>`}).join('')+'</tr>');
  const original=summary('bf16'),qad=summary('qad');
  $('matched-speed-summary').textContent=original&&qad?`NVFP4 QAD: ${(original.e2e_ms.mean/qad.e2e_ms.mean).toFixed(2)}× end-to-end speedup; ${(original.dit_ms.mean/qad.dit_ms.mean).toFixed(2)}× DiT speedup. Request ranges: BF16 ${s(original.e2e_ms.min)}–${s(original.e2e_ms.max)} s; QAD ${s(qad.e2e_ms.min)}–${s(qad.e2e_ms.max)} s.`:'The speed comparison appears after all three seeds complete for both checkpoints.';
  const showDecoders=$('matched-show-decoders').checked;
  $('matched-decoder-panel').hidden=!showDecoders;
  $('matched-decoder-videos').innerHTML=showDecoders?['36l','8l'].map(d=>{
   const r=run(4,d),m=result(4,d,state.gallery,'480p');
   return videoCard({title:`QAD + NVFP4 ${d==='36l'?'Quality 36L':'Fast 8L'}`,meta:`4 GPUs · CAKE · seed ${state.gallerySeed} · ${m?s(m.e2e_ms.mean)+' s · three-seed mean':'Pending'}`,url:r?.media?.[mediaKey],pro:true,key:'matched-decoder-'+d});
  }).join(''):'';
 }else{
 $('matched-checkpoint-videos').innerHTML='';$('matched-decoder-videos').innerHTML='';
 const originals=[{title:'DGX Spark · 36L decoder',prefix:'spark1x-36l',device:'spark1',decoder:'36l'},{title:'DGX Spark · 8L decoder',prefix:'spark1x-8l',device:'spark1',decoder:'8l'},{title:'Apple M5 Max · 36L decoder',prefix:'m5max-36l',device:'m5max',decoder:'36l'}];
 $('source-videos').innerHTML=originals.map(x=>videoCard({title:x.title,meta:shortTime(R.official.latency[`${key}|${x.decoder}`]?.[x.device])+` end to end · ${x.device==='m5max'?'single run':'three-seed mean'} · article`,url:`${source}media/outputs/${x.prefix}-${state.gallery}-480p.mp4`,poster:`${source}media/posters/${x.prefix}-${state.gallery}-480p.jpg`,key:x.prefix})).join('');
 $('pro-videos').innerHTML=['36l','8l'].map(d=>{const m=result(state.galleryGpu,d,state.gallery,'480p');return videoCard({title:`${state.galleryGpu}× PRO 5000 · ${d==='36l'?'36L':'8L'} decoder`,meta:`${m?s(m.e2e_ms.mean)+' s · three-seed mean':pending(state.galleryGpu,d,state.gallery,'480p')} · NVFP4 QAD · vLLM-Omni + CAKE`,url:run(state.galleryGpu,d)?.media?.[key],pro:true,key:'pro-'+d})}).join('');
 $('pro-videos').insertAdjacentHTML('afterbegin',checkpointCard('bf16',0));
 }
 $('gallery-title').textContent=names[state.gallery]+' · 5 s request';$('gallery-status').textContent=names[state.gallery]+(checkpointView&&!document.querySelector('#matched-checkpoint-videos video,#matched-decoder-videos video')?'. Waiting for the matched BF16/QAD outputs.':'. Ready to compare available outputs.');
 $('prompt-source').href=w.source_url;$('prompt-hash').textContent=w.prompt_sha256;
 $('references').querySelector('summary').textContent=`Source references (${w.references.length})`;
 $('reference-media').innerHTML=w.references.map((r,i)=>{const u=esc(r.url);let media;if(/\.(png|jpe?g|webp)$/i.test(r.url))media=`<img loading="lazy" src="${u}" alt="Original reference image ${i+1}">`;else if(/\.(mp3|wav|flac)$/i.test(r.url))media=`<audio controls preload="none" src="${u}"></audio>`;else media=`<video controls muted playsinline preload="none" src="${u}"></video>`;return `<figure>${media}<figcaption><a href="${u}">Reference ${i+1} ↗</a></figcaption></figure>`}).join('');
 attachPlayer();
}
function renderChart(){
 const key=`${state.workload}|${state.resolution}|${state.decoder}`,original=R.official.latency[key]||{};
 const workloadKey=`${state.workload}|${state.resolution}`,offload=offloadRun(state.decoder),recovered=offloadResult(state.decoder),planned=R.offload_plan?.cases.some(c=>c.decoder===state.decoder&&c.key===workloadKey);
 const rows=[4,1].map(g=>({label:`${g}× RTX PRO 5000`,note:`vLLM-Omni · NVFP4 QAD · CAKE · GPU resident · sampled peak ${gib(memoryFor(run(g,state.decoder),workloadKey))} GiB/GPU`,value:result(g,state.decoder)?.e2e_ms.mean/1000,kind:'pro',missing:pending(g,state.decoder)}));
 for(const strategy of ['module','layerwise']){
  const record=offloadRecord(state.decoder,state.workload,state.resolution,strategy);
  if(record)rows.push({label:`1× RTX PRO 5000 · ${strategy} offload`,note:`${record.recovered?'Previously OOM → now successful':'Previously OOM · recovery test'} · ${offloadPeak(record)}`,value:record.summary?.e2e_ms.mean/1000,kind:`pro offload ${strategy}`,missing:offloadState(state.decoder,state.workload,state.resolution,strategy)});
 }
 rows.push(...R.official.devices.map(d=>({label:d.label,note:d.note,value:original[d.key],kind:d.key.startsWith('spark')?'spark':'other',missing:articleStatus(d.key,state.workload,state.resolution,state.decoder)})));
 const max=Math.max(...rows.filter(x=>Number.isFinite(x.value)).map(x=>x.value),1);
 $('chart-title').textContent=`${names[state.workload]} · ${state.resolution} · ${state.decoder==='36l'?'36':'8'}-layer decoder`;
 $('latency-chart').innerHTML=rows.map(r=>`<div class="bar-row ${r.kind}"><div class="bar-label">${esc(r.label)}<small>${esc(r.note)}</small></div><div class="bar-area">${Number.isFinite(r.value)?`<div class="bar ${r.kind}" style="width:${r.value/max*100}%" title="${r.value.toFixed(3)} seconds"><span class="bar-value">${shortTime(r.value)}</span></div>`:`<span class="bar-missing">${esc(r.missing)}</span>`}</div></div>`).join('');
 const resident=result(1,state.decoder),residentStatus=pending(1,state.decoder);
 $('capacity-summary').innerHTML=planned?`<strong>Original resident result: ${esc(residentStatus)}.</strong> ${['module','layerwise'].map(strategy=>{const r=offloadRecord(state.decoder,state.workload,state.resolution,strategy);return !r?'':r.recovered?`${strategy==='module'?'Module':'Layerwise'} CPU offload: <strong>OOM → Success (3/3 seeds)</strong>, ${s(r.summary.e2e_ms.mean)} s, ${offloadPeak(r)}.`:`${strategy==='module'?'Module':'Layerwise'} CPU offload: ${esc(offloadState(state.decoder,state.workload,state.resolution,strategy))}.`;}).join(' ')} Transfers are included. <a href="#module-offload">Full history and outputs →</a>`:resident?`<strong>Single-GPU resident execution.</strong> ${s(resident.e2e_ms.mean)} s, sampled peak ${gib(resident.memory)} GiB. CPU offload is disabled. Memory capacity is assessed through completed request sizes and offload requirements.`:'Single-GPU capacity will be assessed after the request completes.';
 renderStages();renderMatrix();
}
function renderStages(){
 $('stage-policy').disabled=state.stageGpu!==1;
 const useOffload=state.stageGpu===1&&$('stage-policy').value!=='resident',strategy=$('stage-policy').value==='layerwise'?'layerwise':'module',r=useOffload?offloadRun(state.decoder,strategy):run(state.stageGpu,state.decoder),m=useOffload?offloadResult(state.decoder,state.workload,state.resolution,strategy):result(state.stageGpu,state.decoder);
 if(!m){$('stages').innerHTML=`<p class="small">${useOffload?offloadState(state.decoder,state.workload,state.resolution,strategy):pending(state.stageGpu,state.decoder)} — stage timings will appear when all three measurements complete.</p>`;return}
 const total=m.e2e_ms.mean,parts=[{name:'DiT',value:m.dit_ms?.mean||0,color:'#147851'},{name:'Prompt encoding',value:m.encode_prompt_ms?.mean||0,color:'#4989c4'},{name:'Reference encoding',value:m.reference_encode_ms?.mean||0,color:'#8bb6d3'},{name:'Video decoding',value:m.video_vae_ms?.mean||0,color:'#c79751'}];
 const used=parts.reduce((n,p)=>n+p.value,0);parts.push({name:'Audio, MP4 & other',value:Math.max(0,total-used),color:'#b8bdb7'});
 $('stages').innerHTML=`<div class="stage-total"><strong>${s(total)} s mean</strong> · range ${s(m.e2e_ms.min)}–${s(m.e2e_ms.max)} s · ${r.offload?'CPU offload':'GPU resident'}</div><div class="stage-stack">${parts.map(p=>`<span style="width:${p.value/Math.max(total,used)*100}%;background:${p.color}"></span>`).join('')}</div><div class="stage-values">${parts.map(p=>`<div><i class="key" style="background:${p.color}"></i>${p.name}<b>${s(p.value)} s</b></div>`).join('')}</div><p class="small">${m.memory?`Peak during this configuration’s measured requests: ${gib(m.memory)} GiB/GPU. ${memTitle(m.memory)}.`:''} Stage means are recorded by the server; the remainder includes audio decoding, encoding the MP4 and transport.</p>`;
}
function proCell(g,d,w,res){const m=result(g,d,w,res);return m?`<td class="pro-col number" tabindex="0" title="${esc(trialTitle(m))}">${s(m.e2e_ms.mean)}</td>`:`<td class="pro-col pending">${pending(g,d,w,res)}</td>`;}
function renderTables(){
 const number=n=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1}):'—';
 $('reference-table').tBodies[0].innerHTML=R.workloads.map(w=>`<tr><th scope="row">${names[w.id]}</th>${['480p','768p'].map(res=>{const a=R.official.latency[`${w.id}|${res}|36l`];return `<td class="number">${number(a.spark2)}</td><td>${number(a.spark1)}</td>${proCell(4,'36l',w.id,res)}${proCell(1,'36l',w.id,res)}`}).join('')}</tr>`).join('');
 $('local-table').tBodies[0].innerHTML=R.workloads.map(w=>{const a=R.official.latency[`${w.id}|480p|36l`],m=offloadResult('36l',w.id,'480p'),planned=R.offload_plan?.cases.some(c=>c.decoder==='36l'&&c.key===w.id+'|480p');return `<tr><th scope="row">${names[w.id]}</th>${['spark1','rtx5090','rtx3090','m5max'].map(d=>`<td>${Number.isFinite(a[d])?number(a[d]):esc(articleStatus(d,w.id,'480p','36l'))}</td>`).join('')}${proCell(1,'36l',w.id,'480p')}<td class="pro-col">${m?s(m.e2e_ms.mean):planned?esc(offloadState('36l',w.id,'480p')):'Not tested'}</td>${proCell(4,'36l',w.id,'480p')}</tr>`}).join('');
}
function renderMatrix(){
 const rows=[];
 for(const w of R.workloads)for(const res of ['480p','768p'])for(const d of ['36l','8l']){
 const a=result(1,d,w.id,res),b=result(4,d,w.id,res),active=state.workload===w.id&&state.resolution===res&&state.decoder===d;
 const media=[1,4].some(g=>run(g,d)?.media?.[`${w.id}|${res}`]);
 rows.push(`<tr data-workload="${w.id}" data-res="${res}" data-decoder="${d}" class="${active?'active':''}" tabindex="0" aria-label="${names[w.id]}, ${res}, ${d}"><th scope="row">${names[w.id]}</th><td>${res}</td><td>${d==='36l'?'36L':'8L'}</td>${proCell(1,d,w.id,res)}${proCell(4,d,w.id,res)}${[1,4].map(g=>{const m=memoryFor(run(g,d),w.id+'|'+res);return `<td title="${esc(memTitle(m))}">${gib(m)}</td>`}).join('')}<td>${a&&b?(a.e2e_ms.mean/b.e2e_ms.mean).toFixed(2)+'×':'—'}</td><td>${media?'<a href="#output-dialog" class="view-output">View ↗</a>':'—'}</td></tr>`);
 }
 $('matrix').tBodies[0].innerHTML=rows.join('');
 const choose=row=>{state.workload=row.dataset.workload;state.resolution=row.dataset.res;state.decoder=row.dataset.decoder;for(const n of ['workload','resolution','decoder'])$('latency-'+n).value=state[n];renderChart()};
 $('matrix').tBodies[0].querySelectorAll('tr').forEach(row=>{row.addEventListener('click',e=>{if(e.target.closest('.view-output')){e.preventDefault();openOutputs(row.dataset.workload,row.dataset.res,row.dataset.decoder)}else choose(row)});row.addEventListener('keydown',e=>{if(e.target!==row)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(row)}})});
}
function openOutputs(w,res,d){
 $('output-title').textContent=`${names[w]} · ${res} · ${d==='36l'?'36L':'8L'} · seed 0`;
 $('output-videos').innerHTML=[1,4].map(g=>videoCard({title:`${g}× PRO 5000 · vLLM-Omni`,meta:'CAKE attention · original generated video',url:run(g,d)?.media?.[`${w}|${res}`],pro:true})).join('');$('output-dialog').showModal();
}
const checkpointLabels={BF16:'Original BF16',B:'QAD + original decoder',D:'QAD + NVFP4 36L',C:'QAD + NVFP4 8L'};
const checkpointParts=[['prompt_ms','Prompt','#4989c4'],['reference_ms','Reference','#8bb6d3'],['dit_ms','DiT','#147851'],['video_vae_ms','Video decode','#c79751'],['audio_ms','Audio decode','#9674ad'],['other_ms','Other','#b8bdb7']];
function renderCheckpointStack(){
 const x=R.baseline.find(x=>x.id===$('checkpoint-select').value),t=x?.median_request;
 if(!t){$('checkpoint-stack').innerHTML='<p class="small">Pending measurement.</p>';return}
 $('checkpoint-stack').innerHTML=`<div class="stage-total"><strong>${s(t.e2e_ms)} s</strong> · ${esc(checkpointLabels[x.id])} · ${esc(t.key)}</div><div class="stage-stack">${checkpointParts.map(([k,n,c])=>`<span title="${n}: ${s(t[k])} s" style="width:${t[k]/t.e2e_ms*100}%;background:${c}"></span>`).join('')}</div><div class="stage-values">${checkpointParts.map(([k,n,c])=>`<div><i class="key" style="background:${c}"></i>${n}<b>${s(t[k])} s</b></div>`).join('')}</div>`;
}
function renderCheckpoints(){
 const base=R.baseline.find(x=>x.id==='BF16')?.median?.e2e_ms;
 $('checkpoint-summary').innerHTML=R.baseline.map(x=>`<div><b>${checkpointLabels[x.id]}</b><strong>${x.median?s(x.median.e2e_ms)+' s':'—'}</strong><span>${x.median?'Median of three requests':statusName(x.state)}</span><em>${x.median&&base?(x.id==='BF16'?'Reference deployment':(base/x.median.e2e_ms).toFixed(2)+'× vs BF16 deployment'):''}</em></div>`).join('');
 $('checkpoint-breakdown').tBodies[0].innerHTML=R.baseline.map(x=>`<tr><th>${checkpointLabels[x.id]}</th>${[...checkpointParts.map(p=>p[0]),'e2e_ms'].map(k=>`<td>${s(x.stage_medians?.[k])}</td>`).join('')}</tr>`).join('');
 $('checkpoint-select').innerHTML=R.baseline.map(x=>`<option value="${x.id}">${checkpointLabels[x.id]}</option>`).join('');
 $('checkpoint-select').addEventListener('change',renderCheckpointStack);renderCheckpointStack();
 $('checkpoint-config').tHead.innerHTML='<tr><th>Setting</th>'+R.baseline.map(x=>`<th>${checkpointLabels[x.id]}</th>`).join('')+'</tr>';
 const configRows=[['Checkpoint',x=>`<a href="https://huggingface.co/FastVideo/${x.id==='BF16'?'FastVideo-FastH3-Omni-8-Step-V1':'FastH3-Omni-NVFP4-QAD'}">${x.id==='BF16'?'Original BF16':'NVFP4 QAD'} ↗</a><br><code>${esc(x.checkpoint_revision?.slice(0,12)||'Pending')}</code>`],['Video decoder',x=>({BF16:'Original VAE · FP16 autocast',B:'Original VAE · FP16 autocast',D:'NVFP4 Quality 36L',C:'NVFP4 Fast 8L'}[x.id])],['Decoder export revision',x=>x.configuration?.decoder_revision?`<code>${x.configuration.decoder_revision.slice(0,12)}</code>`:'Bundled original'],['DiT distribution',x=>x.hsdp?'HSDP sharded':'Resident replicas'],['Peak sampled memory / GPU',x=>x.memory?.max_per_gpu_gib?x.memory.max_per_gpu_gib.toFixed(1)+' GiB':'Pending'],['Exact server config',x=>x.config_url?`<a href="${esc(x.config_url)}" download>Download YAML ↓</a>`:'Pending']];
 $('checkpoint-config').tBodies[0].innerHTML=configRows.map(([label,fn])=>`<tr><th>${label}</th>${R.baseline.map(x=>`<td>${fn(x)}</td>`).join('')}</tr>`).join('');
}
function renderAttention(){
 const g=Number($('attention-gpu').value),d=$('attention-decoder').value,res=$('attention-resolution').value,key='image|'+res;
 const rows=[{label:'CAKE · INT8 QK / FP8 V',r:fvRun(g,d)},{label:'Hao AI Lab VSA · BF16',r:R.attention_runs?.find(x=>x.id===`fastvideo-pro5000-${g}gpu-${d}-vsa-bf16`)},{label:'FastVideo VSA + Sage2 · INT8 / FP8',mode:'vsa-sage2',r:R.attention_runs?.find(x=>x.id===`fastvideo-pro5000-${g}gpu-${d}-vsa-sage2`)},{label:'Hao AI Lab VSA + Sage3 · FP4',r:R.attention_runs?.find(x=>x.id===`fastvideo-pro5000-${g}gpu-${d}-vsa-sage3`)}];
 rows.forEach(x=>x.m=x.r?.summaries?.find(m=>m.key===key));const cake=rows[0].m?.e2e_ms.mean,cakeDit=rows[0].m?.dit_ms?.mean;
 $('attention-status').textContent=`${R.attention_completed_configurations||0} / ${R.attention_plan?.configurations||26} native attention configurations measured. ${R.priority_attention_status?.state==='running'?'The first matched 4-GPU / 8L comparison is running.':R.attention_status?.state==='waiting_for_fastvideo'?'Remaining configurations are queued after the serving-framework runs.':'Measurements run sequentially on allocated GPUs.'}`;
 $('attention-table').tBodies[0].innerHTML=rows.map(x=>`<tr><th>${x.label}${x.r?.config_url?`<br><a href="${esc(x.r.config_url)}" download>Config YAML ↓</a>`:''}</th>${['e2e_ms','dit_ms','video_vae_ms'].map(k=>`<td>${x.m?s(x.m[k]?.mean):x.mode==='vsa-sage2'&&(g!==4||d!=='8l')?'Outside sample scope':x.r?.state==='failed'?'Incomplete':x.r?.current===key?'Measuring':'Pending'}</td>`).join('')}<td>${cake&&x.m?(x.m.e2e_ms.mean/cake).toFixed(2)+'×':'—'}</td><td>${cakeDit&&x.m?.dit_ms?(x.m.dit_ms.mean/cakeDit).toFixed(2)+'×':'—'}</td></tr>`).join('');
 window.renderAttentionQuality(rows,g,d,res);
}
const fvRun=(g,d)=>(R.fastvideo_runs||[]).find(x=>x.id===`fastvideo-pro5000-${g}gpu-${d}`);
function renderFrameworks(){
 const rows=[];
 for(const g of [1,4])for(const res of ['480p','768p'])for(const d of ['36l','8l']){
  const a=result(g,d,'image',res),fr=fvRun(g,d),b=fr?.summaries?.find(x=>x.key===`image|${res}`);
  const waiting=fr?.state==='failed'?'Incomplete':fr?.current===`image|${res}`?'Measuring':'Pending';
  const media=run(g,d)?.media?.[`image|${res}`]||fr?.media?.[`image|${res}`];
  rows.push(`<tr><th scope="row">${g} GPU${g>1?'s':''}</th><td>${res}</td><td>${d==='36l'?'36L':'8L'}</td><td title="${esc(trialTitle(a))}">${a?s(a.e2e_ms.mean):pending(g,d,'image',res)}</td><td title="${esc(trialTitle(b))}">${b?s(b.e2e_ms.mean):waiting}</td><td>${a&&b?(b.e2e_ms.mean/a.e2e_ms.mean).toFixed(2)+'×':'—'}</td><td>${media?`<a href="#output-dialog" data-framework-gpu="${g}" data-res="${res}" data-decoder="${d}">View ↗</a>`:'—'}</td></tr>`);
 }
 $('framework-table').tBodies[0].innerHTML=rows.join('');
 const count=R.fastvideo_completed_configurations||0,status=R.fastvideo_status?.state;
 $('framework-status').textContent=`${count} / 8 FastVideo configurations measured. ${status==='waiting_for_vllm_matrix'?'Queued after the vLLM matrix; GPU measurements run sequentially.':status==='waiting_for_resources'?'Waiting for the selected GPUs to become available.':status==='complete'?'Matched serving comparison complete.':status==='needs_attention'?'Some FastVideo configurations are incomplete.':'Native serving validation and measurements in progress.'}`;
 $('framework-table').querySelectorAll('[data-framework-gpu]').forEach(link=>link.addEventListener('click',e=>{
  e.preventDefault();const g=Number(link.dataset.frameworkGpu),d=link.dataset.decoder,res=link.dataset.res;
  $('output-title').textContent=`${g}× PRO 5000 · 1 image · ${res} · ${d.toUpperCase()} · seed 0`;
  $('output-videos').innerHTML=[{title:'vLLM-Omni',r:run(g,d)},{title:'FastVideo native serve',r:fvRun(g,d)}].map(x=>videoCard({title:x.title,meta:'NVFP4 QAD · CAKE · GPU resident',url:x.r?.media?.[`image|${res}`],pro:true})).join('');
  $('output-dialog').showModal();
 }));
}
for(const id of ['gallery-workload','latency-workload'])$(id).innerHTML=R.workloads.map(w=>`<option value="${w.id}">${names[w.id]}</option>`).join('');
for(const key of ['workload','resolution','decoder'])$('latency-'+key).value=state[key];
function renderMemory(){
 const config=$('memory-configuration').value,phase=$('memory-phase').value;
 const rows=(R.request_memory||[]).filter(r=>(config==='all'||r.configuration===config)&&(phase==='all'||phase==='failed'&&r.status!=='complete'||phase==='warmup'&&r.phase==='warmup'&&r.status==='complete'||phase==='measured'&&['measured','qualitative'].includes(r.phase)&&r.status==='complete'));
 $('memory-status').textContent=`${rows.length} requests; ${rows.filter(r=>r.memory).length} with request-bounded samples. Units: GiB (1024 MiB).`;
 $('memory-table').tBodies[0].innerHTML=rows.map(r=>{const m=r.memory;return `<tr><th>${esc(r.configuration)}</th><td>${esc(names[r.workload]||r.workload)}</td><td>${esc(r.resolution)}</td><td>${r.seed??'Unknown'} / ${esc(r.phase)}</td><td>${esc(r.status)}${r.oom_reported_process_gib?`<small class="memory-note">OOM process report: ${r.oom_reported_process_gib.toFixed(2)} GiB</small>`:''}</td><td>${s(r.e2e_ms)}</td><td>${gib(m)}</td><td>${Number.isFinite(m?.peak_total_gib)?m.peak_total_gib.toFixed(2):'—'}</td><td>${m?Object.entries(m.per_gpu_mib).map(([g,v])=>`GPU ${g}: ${(v/1024).toFixed(2)}`).join('<br>'):'—'}</td><td>${m?`${m.samples} samples · ${m.sampling_interval_s?.toFixed(2)??'—'} s cadence${m.bounds_source==='server_log_start_second_resolution'?'<small class="memory-note">Start recovered from server log</small>':''}`:esc(r.memory_status)}</td></tr>`}).join('');
}
function renderOffload(){
 const records=R.offload_records||[],done=records.filter(r=>r.recovered),recovered=new Set(done.map(r=>r.decoder+'|'+r.key)),keys=[...new Set(records.map(r=>r.decoder+'|'+r.key))];
 $('offload-table').tBodies[0].innerHTML=records.map(c=>{const r=offloadRun(c.decoder,c.strategy),m=c.summary,[w,res]=c.key.split('|'),url=r?.media?.[c.key];
 return `<tr data-configuration="${esc(c.configuration)}" data-key="${esc(c.key)}"><th>${esc(names[w])}</th><td>${res}</td><td>${c.decoder.toUpperCase()}</td><td>${c.strategy==='module'?'Module':'Layerwise'}</td><td class="${c.recovered?'recovered-result':''}">OOM → ${c.recovered?'Success (3/3 seeds)':esc(offloadState(c.decoder,w,res,c.strategy))}</td><td>${gib(c.resident_memory)}</td><td>${m?s(m.e2e_ms.mean):'Not available'}</td><td>${esc(offloadPeak(c))}</td><td>${url?`<a href="${esc(url)}">Seed 0 MP4 ↗</a>`:'No output yet'}${r?.config_url?`<br><a href="${esc(r.config_url)}" download>Offload config ↓</a>`:''}${c.resident_config_url?`<br><a href="${esc(c.resident_config_url)}" download>Original OOM config ↓</a>`:''}</td></tr>`;}).join('');
 $('offload-status').textContent=`${done.length} / ${records.length} offload configurations successful; ${recovered.size} / ${keys.length} original OOM configurations recovered with at least one strategy. Every success requires three measured seeds after an excluded warmup.`;
 $('offload-strategy-table').tBodies[0].innerHTML=keys.map(k=>{const [d,w,res]=k.split('|'),a=offloadRecord(d,w,res,'module'),b=offloadRecord(d,w,res,'layerwise'),both=a?.recovered&&b?.recovered;return `<tr><th>${names[w]}</th><td>${res} · ${d.toUpperCase()}</td><td>${a?.summary?s(a.summary.e2e_ms.mean):esc(offloadState(d,w,res,'module'))}</td><td>${b?.summary?s(b.summary.e2e_ms.mean):esc(offloadState(d,w,res,'layerwise'))}</td><td>${both?(b.summary.e2e_ms.mean/a.summary.e2e_ms.mean).toFixed(2)+'×':'Awaiting both'}</td><td>${both?(a.memory.max_per_gpu_gib-b.memory.max_per_gpu_gib).toFixed(2)+' GiB':'Awaiting both'}</td><td>${b?.output_matches?.length===3&&b.output_matches.every(x=>x.mp4_bytes_identical)?'Identical · all 3 seeds':b?.output_matches?.length?b.output_matches.filter(x=>x.mp4_bytes_identical).length+'/'+b.output_matches.length+' available pairs identical':'Awaiting paired outputs'}</td></tr>`}).join('');
}
$('memory-configuration').innerHTML+=[...new Set((R.request_memory||[]).map(x=>x.configuration))].sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
for(const id of ['memory-configuration','memory-phase'])$(id).addEventListener('change',renderMemory);
function renderReferenceCanvas(){
 const a=R.reference_canvas_audit?.policies?.article2048,b=R.reference_canvas_audit?.policies?.native;
 if(a&&b){
  const size=x=>x.join(' × ');
  $('reference-size-table').tBodies[0].innerHTML=a.images.map((x,i)=>`<tr><th>Picture ${i+1}</th><td>${size(x.original_wh)}</td><td>${size(x.reference_vae_wh)}</td><td>${size(b.images[i].reference_vae_wh)}</td><td>${(x.vision_tokens+x.vae_tokens).toLocaleString('en-US')} → ${(b.images[i].vision_tokens+b.images[i].vae_tokens).toLocaleString('en-US')}</td></tr>`).join('');
  $('reference-token-summary').textContent=`Effective packed sequence: ${a.packed_effective_tokens.toLocaleString('en-US')} → ${b.packed_effective_tokens.toLocaleString('en-US')} tokens (${(R.reference_canvas_audit.effective_token_reduction_fraction*100).toFixed(1)}% fewer). Native: ${b.vision_tokens.toLocaleString('en-US')} vision + ${b.reference_vae_tokens.toLocaleString('en-US')} reference VAE + ${b.prompt_and_label_tokens} prompt/labels + ${b.video_tokens.toLocaleString('en-US')} video + ${b.audio_tokens} audio tokens. Kernel padding is additional.`;
 }
 const rows=R.native_reference_runs||[],ref=rows.find(r=>r.mode==='resident');
 $('native-reference-table').tBodies[0].innerHTML=rows.map(r=>{
  const m=r.summaries?.find(x=>x.key==='images3|480p'),f=r.failures?.find(x=>x.key==='images3|480p'),n=Object.keys(r.output_hashes||{}).length;
  const status=m?'Complete · 3/3 seeds':f?.kind==='cuda_oom'?'OOM':f?'Failed':r.active_request?.phase==='warmup'?'Warmup in progress':r.state==='starting'?'Loading model':r.state==='measuring'?`Measuring · ${n}/3 seeds`:'Superseded · ComfyUI match';
  const pairs=[0,1,2].filter(seed=>r.output_hashes?.[seed]&&ref?.output_hashes?.[seed]);
  const eq=r.mode==='resident'?'Reference':pairs.length===3?`${pairs.filter(seed=>r.output_hashes[seed]===ref.output_hashes[seed]).length}/3 byte-identical`:'Awaiting paired outputs';
  return `<tr data-mode="${esc(r.mode)}"><th>${esc({resident:'GPU resident',module:'Module CPU offload',layerwise:'Layerwise CPU offload'}[r.mode])}</th><td>${status}</td><td>${m?s(m.e2e_ms.mean):'—'}</td><td>${m?s(m.dit_ms.mean):'—'}</td><td>${m?gib(m.memory):'Not yet measured'}</td><td>${eq}</td><td>${r.media?.['images3|480p']?`<a href="${esc(r.media['images3|480p'])}">Seed 0 MP4 ↗</a>`:''}${r.config_url?` <a href="${esc(r.config_url)}" download>Config ↓</a>`:''}</td></tr>`;
 }).join('');
 const base=ref?.summaries?.[0],layer=rows.find(r=>r.mode==='layerwise')?.summaries?.[0];
 $('native-reference-summary').textContent=base&&layer?`Layerwise / resident: ${(layer.e2e_ms.mean/base.e2e_ms.mean).toFixed(3)}× end-to-end, ${(layer.dit_ms.mean/base.dit_ms.mean).toFixed(3)}× DiT. These are observed timing ratios; a transfer timeline is required to quantify hidden copy time. MP4 byte equality does not compare quality against the different historical reference canvas.`:'This native-size diagnostic is retained as historical evidence. All further offload measurements use the ComfyUI match policy shown above.';
}
renderMemory();renderOffload();renderReferenceCanvas();
$('gallery-comparison').addEventListener('change',e=>{state.galleryComparison=e.target.value;renderGallery()});
$('gallery-seed').addEventListener('change',e=>{state.gallerySeed=Number(e.target.value);renderGallery()});
$('matched-show-decoders').addEventListener('change',renderGallery);
$('gallery-workload').addEventListener('change',e=>{state.gallery=e.target.value;renderGallery()});$('gallery-gpu').addEventListener('change',e=>{state.galleryGpu=Number(e.target.value);renderGallery()});$('next-example').addEventListener('click',()=>{state.gallery=R.workloads[(R.workloads.findIndex(w=>w.id===state.gallery)+1)%R.workloads.length].id;$('gallery-workload').value=state.gallery;renderGallery()});
for(const n of ['workload','resolution','decoder'])$('latency-'+n).addEventListener('change',e=>{state[n]=e.target.value;renderChart()});$('stage-gpu').addEventListener('change',e=>{state.stageGpu=Number(e.target.value);renderStages()});
$('stage-policy').addEventListener('change',renderStages);
$('close-dialog').addEventListener('click',()=>$('output-dialog').close());$('output-dialog').addEventListener('close',()=>$('output-videos').querySelectorAll('video').forEach(v=>v.pause()));
try{if(localStorage.getItem('omni-theme')==='dark')document.documentElement.dataset.theme='dark'}catch{}
$('theme').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;try{localStorage.setItem('omni-theme',theme)}catch{}});
$('coverage').textContent=`${R.completed_configurations} / 40 configurations measured${R.oom_configurations?' · '+R.oom_configurations+' OOM':''}`;$('run-status').textContent=statusName(R.status.state);$('updated').textContent='Updated '+new Date(R.updated_at*1000).toLocaleString('en-GB',{timeZone:'Asia/Shanghai',hour12:false})+' UTC+8';
for(const id of ['attention-gpu','attention-resolution','attention-decoder','quality-seed'])$(id).addEventListener('change',renderAttention);
renderGallery();renderChart();renderTables();renderCheckpoints();renderFrameworks();renderAttention();
window.reportUI={state,renderGallery,renderChart,openOutputs,get player(){return player}};
if(R.active_preprocessing_policy?.policy==='comfy')$('run-status').textContent='Archived article-canvas results · current ComfyUI study above';
