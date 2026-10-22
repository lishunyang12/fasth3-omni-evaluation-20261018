'use strict';
const R=window.REPORT,$=id=>document.getElementById(id);
const names={image:'1 image','image-voice':'Image + voice',images3:'3 images',clip:'1 short clip',video:'1 long clip'};
const source='https://haoailab.com/blogs/fasth3-omni-local/';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const s=ms=>Number.isFinite(ms)?(ms/1000).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const shortTime=secs=>Number.isFinite(secs)?(secs>=180?(secs/60).toFixed(1)+' min':secs.toFixed(1)+' s'):'Not reported';
const state={gallery:'image',galleryGpu:4,workload:'image',resolution:'480p',decoder:'36l',stageGpu:4};
const run=(g,d)=>R.runs.find(x=>x.id===`pro5000-${g}gpu-${d}`);
const result=(g,d,w=state.workload,res=state.resolution)=>run(g,d)?.summaries?.find(x=>x.key===`${w}|${res}`);
const statusName=x=>({complete:'Complete',failed:'Incomplete',needs_attention:'Some runs need attention',starting:'Loading model',measuring:'Measuring',pending:'Pending',benchmarking:'Measuring',generating:'Generating comparison videos',waiting_for_checkpoint_study:'BF16 / QAD study in progress',running_4gpu:'4-GPU matrix in progress',running_1gpu:'1-GPU matrix in progress'}[x]||'In progress');
const pending=(g,d,w=state.workload,res=state.resolution)=>{const r=run(g,d);return r?.state==='failed'?'Incomplete':r?.current===`${w}|${res}`?'Measuring':'Pending'};
const trialTitle=x=>x?`Three runs: ${x.e2e_ms.values.map(v=>s(v)+' s').join(' / ')}. Mean ${s(x.e2e_ms.mean)} s; range ${s(x.e2e_ms.min)}–${s(x.e2e_ms.max)} s.`:'';
let player=null;
function videoCard({title,meta,url,poster,pro=false,key}){return `<div class="video-card ${pro?'pro-card':''}" data-key="${esc(key||title)}"><h4>${esc(title)}</h4><p class="video-meta">${esc(meta)}</p>${url?`<video controls muted playsinline preload="${pro?'metadata':'none'}" ${poster?`poster="${esc(poster)}"`:''} src="${esc(url)}" aria-label="${esc(title)}"></video><a class="download" href="${esc(url)}" download>Download original MP4</a>`:'<div class="empty-video"><strong>Awaiting measured output</strong><span>Published after this request completes.</span></div><span class="download">Not available yet</span>'}</div>`;}
function attachPlayer(){
 player?.dispose();
 const videos=[...document.querySelectorAll('#source-videos video,#pro-videos video')];
 const titles=videos.map(v=>v.closest('.video-card').querySelector('h4').textContent);
 $('gallery-player').innerHTML=`<button id="play-all" type="button">Play together</button><button id="pause-all" type="button">Pause all</button><label>Listen to <select id="gallery-audio"><option value="-1">Mute all</option>${titles.map((t,i)=>`<option value="${i}">${esc(t)}</option>`).join('')}</select></label><input id="gallery-timeline" aria-label="Video frame" type="range" min="0" max="123" step="1" value="0"><span class="time">0.00 / 5.17 s</span>`;
 const button=$('play-all'),timeline=$('gallery-timeline'),clock=$('gallery-player').querySelector('.time');let playing=false,disposed=false,timer=null;
 const pause=()=>{playing=false;videos.forEach(v=>v.pause());if(timer)cancelAnimationFrame(timer);timer=null;};
 const seek=time=>{pause();videos.forEach(v=>{if(v.readyState>=1)v.currentTime=Math.min(time,Math.max(0,v.duration-.03))});timeline.value=Math.round(time*24);clock.textContent=`${time.toFixed(2)} / 5.17 s`;};
 const tick=()=>{if(!playing||disposed)return;const lead=videos[0];if(lead.ended){pause();return}timeline.value=Math.min(123,Math.round(lead.currentTime*24));clock.textContent=`${lead.currentTime.toFixed(2)} / 5.17 s`;for(const v of videos.slice(1))if(v.readyState>=2&&Math.abs(v.currentTime-lead.currentTime)>.15)v.currentTime=lead.currentTime;timer=requestAnimationFrame(tick);};
 const ready=v=>v.readyState>=2?Promise.resolve():new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{cleanup();reject(Error('A video took too long to load. Try again or use its download link.'))},40000);const cleanup=()=>{clearTimeout(timeout);v.removeEventListener('loadeddata',done);v.removeEventListener('error',fail)};const done=()=>{cleanup();resolve()};const fail=()=>{cleanup();reject(Error('A video could not be loaded. Its source may be temporarily unavailable.'))};v.addEventListener('loadeddata',done,{once:true});v.addEventListener('error',fail,{once:true});v.preload='auto';v.load()});
 const play=async()=>{button.disabled=true;$('gallery-status').textContent='Loading selected videos…';try{await Promise.all(videos.map(ready));if(disposed)return;const time=videos[0].currentTime>=5.1?0:videos[0].currentTime;videos.forEach(v=>v.currentTime=time);await Promise.all(videos.map(v=>v.play()));if(disposed){videos.forEach(v=>v.pause());return}playing=true;$('gallery-status').textContent='Playing matched outputs. Use the audio selector to listen to one device.';tick()}catch(e){pause();$('gallery-status').textContent=e.message}finally{button.disabled=false}};
 button.addEventListener('click',play);$('pause-all').addEventListener('click',pause);timeline.addEventListener('input',()=>seek(Number(timeline.value)/24));$('gallery-audio').addEventListener('change',e=>videos.forEach((v,i)=>v.muted=i!==Number(e.target.value)));videos.forEach(v=>v.addEventListener('ended',pause));
 player={play,pause,seek,videos,dispose(){disposed=true;pause();videos.forEach(v=>{v.removeAttribute('src');v.load()})}};
}
function renderGallery(){
 player?.dispose();
 const w=R.workloads.find(x=>x.id===state.gallery),key=state.gallery+'|480p';
 const originals=[{title:'DGX Spark · 36L decoder',prefix:'spark1x-36l',device:'spark1',decoder:'36l'},{title:'DGX Spark · 8L decoder',prefix:'spark1x-8l',device:'spark1',decoder:'8l'},{title:'Apple M5 Max · 36L decoder',prefix:'m5max-36l',device:'m5max',decoder:'36l'}];
 $('source-videos').innerHTML=originals.map(x=>videoCard({title:x.title,meta:shortTime(R.official.latency[`${key}|${x.decoder}`]?.[x.device])+` end to end · ${x.device==='m5max'?'single run':'three-seed mean'} · article`,url:`${source}media/outputs/${x.prefix}-${state.gallery}-480p.mp4`,poster:`${source}media/posters/${x.prefix}-${state.gallery}-480p.jpg`,key:x.prefix})).join('');
 $('pro-videos').innerHTML=['36l','8l'].map(d=>{const m=result(state.galleryGpu,d,state.gallery,'480p');return videoCard({title:`${state.galleryGpu}× PRO 5000 · ${d==='36l'?'36L':'8L'} decoder`,meta:`${m?s(m.e2e_ms.mean)+' s · three-seed mean':pending(state.galleryGpu,d,state.gallery,'480p')} · vLLM-Omni + CAKE`,url:run(state.galleryGpu,d)?.media?.[key],pro:true,key:'pro-'+d})}).join('');
 $('gallery-title').textContent=names[state.gallery]+' · 5 s request';$('gallery-status').textContent=names[state.gallery]+'. Ready to compare available outputs.';
 $('prompt-source').href=w.source_url;$('prompt-hash').textContent=w.prompt_sha256;
 $('references').querySelector('summary').textContent=`Source references (${w.references.length})`;
 $('reference-media').innerHTML=w.references.map((r,i)=>{const u=esc(r.url);let media;if(/\.(png|jpe?g|webp)$/i.test(r.url))media=`<img loading="lazy" src="${u}" alt="Original reference image ${i+1}">`;else if(/\.(mp3|wav|flac)$/i.test(r.url))media=`<audio controls preload="none" src="${u}"></audio>`;else media=`<video controls muted playsinline preload="none" src="${u}"></video>`;return `<figure>${media}<figcaption><a href="${u}">Reference ${i+1} ↗</a></figcaption></figure>`}).join('');
 attachPlayer();
}
function renderChart(){
 const key=`${state.workload}|${state.resolution}|${state.decoder}`,original=R.official.latency[key]||{};
 const rows=[4,1].map(g=>({label:`${g}× RTX PRO 5000`,note:`vLLM-Omni · CAKE · ${g===1?'CPU offload':'GPU resident'}`,value:result(g,state.decoder)?.e2e_ms.mean/1000,kind:'pro',missing:pending(g,state.decoder)})).concat(R.official.devices.map(d=>({label:d.label,note:d.note,value:original[d.key],kind:d.key.startsWith('spark')?'spark':'other',missing:'Not reported'})));
 const max=Math.max(...rows.filter(x=>Number.isFinite(x.value)).map(x=>x.value),1);
 $('chart-title').textContent=`${names[state.workload]} · ${state.resolution} · ${state.decoder==='36l'?'36':'8'}-layer decoder`;
 $('latency-chart').innerHTML=rows.map(r=>`<div class="bar-row ${r.kind}"><div class="bar-label">${esc(r.label)}<small>${esc(r.note)}</small></div><div class="bar-area">${Number.isFinite(r.value)?`<div class="bar ${r.kind}" style="width:${r.value/max*100}%" title="${r.value.toFixed(3)} seconds"><span class="bar-value">${shortTime(r.value)}</span></div>`:`<span class="bar-missing">${r.missing}</span>`}</div></div>`).join('');renderStages();renderMatrix();
}
function renderStages(){
 const m=result(state.stageGpu,state.decoder),r=run(state.stageGpu,state.decoder);
 if(!m){$('stages').innerHTML=`<p class="small">${pending(state.stageGpu,state.decoder)} — stage timings will appear when all three measurements complete.</p>`;return}
 const total=m.e2e_ms.mean,parts=[{name:'DiT',value:m.dit_ms?.mean||0,color:'#147851'},{name:'Prompt encoding',value:m.encode_prompt_ms?.mean||0,color:'#4989c4'},{name:'Reference encoding',value:m.reference_encode_ms?.mean||0,color:'#8bb6d3'},{name:'Video decoding',value:m.video_vae_ms?.mean||0,color:'#c79751'}];
 const used=parts.reduce((n,p)=>n+p.value,0);parts.push({name:'Audio, MP4 & other',value:Math.max(0,total-used),color:'#b8bdb7'});
 $('stages').innerHTML=`<div class="stage-total"><strong>${s(total)} s mean</strong> · range ${s(m.e2e_ms.min)}–${s(m.e2e_ms.max)} s · ${r.offload?'CPU offload':'GPU resident'}</div><div class="stage-stack">${parts.map(p=>`<span style="width:${p.value/Math.max(total,used)*100}%;background:${p.color}"></span>`).join('')}</div><div class="stage-values">${parts.map(p=>`<div><i class="key" style="background:${p.color}"></i>${p.name}<b>${s(p.value)} s</b></div>`).join('')}</div><p class="small">${r.memory?.max_per_gpu_gib?`Maximum sampled per-GPU memory across this run: ${r.memory.max_per_gpu_gib.toFixed(1)} GiB.`:''} Stage means are recorded by the server; the remainder includes audio decoding, encoding the MP4 and transport.</p>`;
}
function proCell(g,d,w,res){const m=result(g,d,w,res);return m?`<td class="pro-col number" tabindex="0" title="${esc(trialTitle(m))}">${s(m.e2e_ms.mean)}</td>`:`<td class="pro-col pending">${pending(g,d,w,res)}</td>`;}
function renderTables(){
 const number=n=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1}):'—';
 $('reference-table').tBodies[0].innerHTML=R.workloads.map(w=>`<tr><th scope="row">${names[w.id]}</th>${['480p','768p'].map(res=>{const a=R.official.latency[`${w.id}|${res}|36l`];return `<td class="number">${number(a.spark2)}</td><td>${number(a.spark1)}</td>${proCell(4,'36l',w.id,res)}${proCell(1,'36l',w.id,res)}`}).join('')}</tr>`).join('');
 $('local-table').tBodies[0].innerHTML=R.workloads.map(w=>{const a=R.official.latency[`${w.id}|480p|36l`];return `<tr><th scope="row">${names[w.id]}</th>${['spark1','rtx5090','rtx3090','m5max'].map(d=>`<td>${number(a[d])}</td>`).join('')}${proCell(1,'36l',w.id,'480p')}${proCell(4,'36l',w.id,'480p')}</tr>`}).join('');
}
function renderMatrix(){
 const rows=[];
 for(const w of R.workloads)for(const res of ['480p','768p'])for(const d of ['36l','8l']){
 const a=result(1,d,w.id,res),b=result(4,d,w.id,res),active=state.workload===w.id&&state.resolution===res&&state.decoder===d;
 const media=[1,4].some(g=>run(g,d)?.media?.[`${w.id}|${res}`]);
 rows.push(`<tr data-workload="${w.id}" data-res="${res}" data-decoder="${d}" class="${active?'active':''}" tabindex="0" aria-label="${names[w.id]}, ${res}, ${d}"><th scope="row">${names[w.id]}</th><td>${res}</td><td>${d==='36l'?'36L':'8L'}</td>${proCell(1,d,w.id,res)}${proCell(4,d,w.id,res)}<td>${a&&b?(a.e2e_ms.mean/b.e2e_ms.mean).toFixed(2)+'×':'—'}</td><td>${media?'<a href="#output-dialog" class="view-output">View ↗</a>':'—'}</td></tr>`);
 }
 $('matrix').tBodies[0].innerHTML=rows.join('');
 const choose=row=>{state.workload=row.dataset.workload;state.resolution=row.dataset.res;state.decoder=row.dataset.decoder;for(const n of ['workload','resolution','decoder'])$('latency-'+n).value=state[n];renderChart()};
 $('matrix').tBodies[0].querySelectorAll('tr').forEach(row=>{row.addEventListener('click',e=>{if(e.target.closest('.view-output')){e.preventDefault();openOutputs(row.dataset.workload,row.dataset.res,row.dataset.decoder)}else choose(row)});row.addEventListener('keydown',e=>{if(e.target!==row)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(row)}})});
}
function openOutputs(w,res,d){
 $('output-title').textContent=`${names[w]} · ${res} · ${d==='36l'?'36L':'8L'} · seed 0`;
 $('output-videos').innerHTML=[1,4].map(g=>videoCard({title:`${g}× PRO 5000 · vLLM-Omni`,meta:'CAKE attention · original generated video',url:run(g,d)?.media?.[`${w}|${res}`],pro:true})).join('');$('output-dialog').showModal();
}
function renderCheckpoints(){const base=R.baseline.find(x=>x.id==='BF16')?.median?.e2e_ms;const labels={BF16:'Original BF16',B:'NVFP4 QAD',C:'NVFP4 QAD + 8L'};$('checkpoint-summary').innerHTML=R.baseline.map(x=>`<div><b>${labels[x.id]}</b><strong>${x.median?s(x.median.e2e_ms)+' s':'—'}</strong><span>${x.median?'Median of three requests':statusName(x.state)}</span><em>${x.median&&base?(x.id==='BF16'?'Reference deployment':(base/x.median.e2e_ms).toFixed(2)+'× vs BF16 deployment'):''}</em></div>`).join('')}
for(const id of ['gallery-workload','latency-workload'])$(id).innerHTML=R.workloads.map(w=>`<option value="${w.id}">${names[w.id]}</option>`).join('');
$('gallery-workload').addEventListener('change',e=>{state.gallery=e.target.value;renderGallery()});$('gallery-gpu').addEventListener('change',e=>{state.galleryGpu=Number(e.target.value);renderGallery()});$('next-example').addEventListener('click',()=>{state.gallery=R.workloads[(R.workloads.findIndex(w=>w.id===state.gallery)+1)%R.workloads.length].id;$('gallery-workload').value=state.gallery;renderGallery()});
for(const n of ['workload','resolution','decoder'])$('latency-'+n).addEventListener('change',e=>{state[n]=e.target.value;renderChart()});$('stage-gpu').addEventListener('change',e=>{state.stageGpu=Number(e.target.value);renderStages()});
$('close-dialog').addEventListener('click',()=>$('output-dialog').close());$('output-dialog').addEventListener('close',()=>$('output-videos').querySelectorAll('video').forEach(v=>v.pause()));
try{if(localStorage.getItem('omni-theme')==='dark')document.documentElement.dataset.theme='dark'}catch{}
$('theme').addEventListener('click',()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;try{localStorage.setItem('omni-theme',theme)}catch{}});
$('coverage').textContent=`${R.completed_configurations} / 40 configurations complete`;$('run-status').textContent=statusName(R.status.state);$('updated').textContent='Updated '+new Date(R.updated_at*1000).toLocaleString('en-GB',{timeZone:'Asia/Shanghai',hour12:false})+' UTC+8';
renderGallery();renderChart();renderTables();renderCheckpoints();
window.reportUI={state,renderGallery,renderChart,openOutputs,get player(){return player}};
