'use strict';
const R=window.REPORT;
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const seconds=(ms,digits=2)=>Number.isFinite(ms)?(ms/1000).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
const state={workload:'image',resolution:'480p',decoder:'36l',stageGpu:4,galleryGpu:4,scene:'family'};
const players=new Map();
const run=(g,d)=>R.runs.find(x=>x.id===`pro5000-${g}gpu-${d}`);
const result=(g,d,w=state.workload,r=state.resolution)=>run(g,d)?.summaries?.find(x=>x.key===`${w}|${r}`);
const statusLabel=s=>({complete:'全部完成',waiting_for_checkpoint_study:'原版 / QAD 对比进行中',running_4gpu:'4 卡矩阵测试中',running_1gpu:'单卡矩阵测试中',needs_attention:'部分配置需要处理',failed:'运行未完成',pending:'待测',starting:'加载模型',measuring:'测量中',benchmarking:'测量中'}[s]||'测试进行中');
function unavailable(g,d,w=state.workload,res=state.resolution){const r=run(g,d);if(r?.state==='failed')return '未完成';if(r?.current===`${w}|${res}`)return '测量中';return '待测';}
function rangeTitle(s){return s?`3 次测量：${s.e2e_ms.values.map(x=>seconds(x)+' s').join(' / ')}；范围 ${seconds(s.e2e_ms.min)}–${seconds(s.e2e_ms.max)} s`:'';}
function selectSegment(id,value){$(id).querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===value)));}
function renderChart(){
 const key=`${state.workload}|${state.resolution}|${state.decoder}`;
 const official=R.official.latency[key]||{};
 const rows=[4,1].map(g=>({label:`${g}× PRO 5000 · CAKE`,value:result(g,state.decoder)?.e2e_ms.mean/1000,local:true,note:unavailable(g,state.decoder)})).concat(R.official.devices.map(d=>({label:d.label,value:official[d.key],local:false,note:'原文未披露',detail:d.note})));
 const maximum=Math.max(...rows.filter(x=>Number.isFinite(x.value)).map(x=>x.value),1);
 $('hardware-chart').innerHTML=rows.map(x=>{const available=Number.isFinite(x.value);return `<div class="chart-row ${x.local?'local':''} ${available?'':'missing'}" title="${esc(x.detail||'本次三种子均值；完整 HTTP 到 MP4')}"><div class="chart-label"><span>${esc(x.label)}</span><b>${available?x.value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' s':esc(x.note)}</b></div><div class="chart-track">${available?`<div class="chart-fill" style="width:${x.value/maximum*100}%"></div>`:''}</div></div>`}).join('');
 renderStages();renderMatrix();renderOfficialVideos();
}
function renderStages(){
 const s=result(state.stageGpu,state.decoder),r=run(state.stageGpu,state.decoder);
 if(!s){$('stages').innerHTML=`<div class="empty"><strong>${unavailable(state.stageGpu,state.decoder)}</strong><span>该配置完成三次测量后，显示均值与阶段耗时。</span></div>`;return;}
 const e2e=s.e2e_ms.mean;
 const parts=[{name:'DiT 去噪',value:s.dit_ms?.mean||0,color:'#2357db'},{name:'文本 / 多模态编码',value:s.encode_prompt_ms?.mean||0,color:'#7094ed'},{name:'参考媒体编码',value:s.reference_encode_ms?.mean||0,color:'#9cafd6'},{name:'视频解码',value:s.video_vae_ms?.mean||0,color:'#6f967d'}];
 const used=parts.reduce((n,p)=>n+p.value,0);parts.push({name:'其他开销',value:Math.max(0,e2e-used),color:'#c9d3ca'});
 $('stages').innerHTML=`<div class="stage-total">${seconds(e2e)}<span>秒 / 视频</span></div><div class="caption">3 次均值 · 范围 ${seconds(s.e2e_ms.min)}–${seconds(s.e2e_ms.max)} 秒</div><div class="stage-stack" aria-hidden="true">${parts.map(p=>`<span style="width:${p.value/Math.max(e2e,used)*100}%;background:${p.color}"></span>`).join('')}</div><div class="stage-list">${parts.map(p=>`<div class="stage-line"><span><i class="key" style="background:${p.color}"></i>${p.name}</span><b>${seconds(p.value)} s</b></div>`).join('')}</div><div class="stage-memory">${r.offload?'CPU offload 开启':'GPU 常驻'} · ${r.memory?.max_per_gpu_gib?`该轮配置最大单卡采样显存 ${r.memory.max_per_gpu_gib.toFixed(1)} GiB`:'显存数据待收集'}</div>`;
}
function renderMatrix(){
 const rows=[];
 for(const w of R.workloads)for(const res of ['480p','768p'])for(const d of ['36l','8l']){
 const a=result(1,d,w.id,res),b=result(4,d,w.id,res),active=state.workload===w.id&&state.resolution===res&&state.decoder===d;
 const cell=(s,g)=>s?`<td title="${esc(rangeTitle(s))}">${seconds(s.e2e_ms.mean)}</td>`:`<td><span class="pending">${unavailable(g,d,w.id,res)}</span></td>`;
 rows.push(`<tr data-workload="${w.id}" data-res="${res}" data-decoder="${d}" class="${active?'active':''}" tabindex="0" aria-label="${esc(w.label)} ${res} ${d}"><th scope="row">${esc(w.label)}</th><td>${res}</td><td>${d==='36l'?'36L':'8L'}</td>${cell(a,1)}${cell(b,4)}<td>${a&&b?(a.e2e_ms.mean/b.e2e_ms.mean).toFixed(2)+'×':'—'}</td></tr>`);
 }
 $('matrix').tBodies[0].innerHTML=rows.join('');
 const choose=row=>{state.workload=row.dataset.workload;state.resolution=row.dataset.res;state.decoder=row.dataset.decoder;$('workload').value=state.workload;selectSegment('resolution',state.resolution);selectSegment('decoder',state.decoder);renderChart();};
 $('matrix').tBodies[0].querySelectorAll('tr').forEach(row=>{row.addEventListener('click',()=>choose(row));row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(row)}})});
}
function makeVideo({title,subtitle,url,caption}){return `<article class="video-card"><div class="video-header"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></div><div class="video-window">${url?`<video muted playsinline preload="metadata" src="${esc(url)}" aria-label="${esc(title)} 生成视频"></video>`:'<div class="empty"><strong>等待实测输出</strong><span>完成后提供该配置的生成视频。</span></div>'}</div><div class="video-caption">${esc(caption)}${url?`<a href="${esc(url)}" download>下载 MP4 ↓</a>`:''}</div></article>`;}
function attachPlayer(container,controls){
 players.get(container)?.dispose();
 const videoEls=[...$(container).querySelectorAll('video')],titles=[...$(container).querySelectorAll('.video-card')].filter(c=>c.querySelector('video')).map(c=>c.querySelector('strong').textContent);
 $(controls).innerHTML=`<button type="button" ${videoEls.length?'':'disabled'} aria-label="同步播放或暂停">同步播放</button><input type="range" min="0" max="123" step="1" value="0" aria-label="对照视频帧" ${videoEls.length?'':'disabled'}><span class="time">0.00 / 5.17 s</span><label>声音<select aria-label="选择声音来源"><option value="-1">静音</option>${titles.map((t,i)=>`<option value="${i}">${esc(t)}</option>`).join('')}</select></label><div class="player-note" role="status"></div>`;
 const box=$(controls),playButton=box.querySelector('button'),slider=box.querySelector('input'),clock=box.querySelector('.time'),audio=box.querySelector('select'),note=box.querySelector('.player-note');let timer=null,playing=false,disposed=false;
 const pause=()=>{playing=false;videoEls.forEach(v=>v.pause());if(timer)cancelAnimationFrame(timer);timer=null;playButton.textContent='同步播放';};
 const seek=t=>{pause();videoEls.forEach(v=>{if(v.readyState>=1)v.currentTime=Math.min(t,Math.max(0,v.duration-.03))});slider.value=Math.round(t*24);clock.textContent=`${t.toFixed(2)} / 5.17 s`;};
 const tick=()=>{if(!playing||disposed)return;const lead=videoEls[0];if(lead.ended){pause();return}slider.value=Math.min(123,Math.round(lead.currentTime*24));clock.textContent=`${lead.currentTime.toFixed(2)} / 5.17 s`;for(const v of videoEls.slice(1))if(v.readyState>=2&&Math.abs(v.currentTime-lead.currentTime)>.1)v.currentTime=lead.currentTime;timer=requestAnimationFrame(tick);};
 const ready=v=>v.readyState>=2?Promise.resolve():new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{cleanup();reject(Error('视频加载超时，请重试。'))},20000);const cleanup=()=>{clearTimeout(timeout);v.removeEventListener('loadeddata',done);v.removeEventListener('error',fail)};const done=()=>{cleanup();resolve()};const fail=()=>{cleanup();reject(Error('视频加载失败。'))};v.addEventListener('loadeddata',done,{once:true});v.addEventListener('error',fail,{once:true});v.load();});
 const play=async()=>{if(!videoEls.length)return;note.textContent='';playButton.disabled=true;try{await Promise.all(videoEls.map(ready));if(disposed)return;const t=videoEls[0].currentTime>=5.1?0:videoEls[0].currentTime;videoEls.forEach(v=>{v.currentTime=t});await Promise.all(videoEls.map(v=>v.play()));if(disposed){videoEls.forEach(v=>v.pause());return}playing=true;playButton.textContent='暂停';tick();}catch(e){pause();note.textContent=e.message;}finally{playButton.disabled=false;}};
 playButton.addEventListener('click',()=>playing?pause():play());slider.addEventListener('input',()=>seek(Number(slider.value)/24));audio.addEventListener('change',()=>videoEls.forEach((v,i)=>{v.muted=i!==Number(audio.value)}));videoEls.forEach(v=>v.addEventListener('ended',pause));
 players.set(container,{play,pause,seek,videos:videoEls,dispose(){disposed=true;pause();videoEls.forEach(v=>{v.removeAttribute('src');v.load()})}});
}
function renderOfficialVideos(){
 players.get('official-videos')?.dispose();
 const key=`${state.workload}|${state.resolution}`;
 $('official-videos').innerHTML=['36l','8l'].map(d=>makeVideo({title:d==='36l'?'NVFP4 · 36L Quality':'NVFP4 · 8L Fast',subtitle:`${state.galleryGpu} 卡 · ${state.resolution}`,url:run(state.galleryGpu,d)?.media?.[key],caption:`${R.workloads.find(w=>w.id===state.workload).label} · seed 0`})).join('');
 $('input-source').href=R.workloads.find(w=>w.id===state.workload).source_url;attachPlayer('official-videos','official-player');
}
function renderBaseline(){
 const reference=R.baseline.find(b=>b.id==='BF16')?.median?.e2e_ms;
 $('baseline-cards').innerHTML=R.baseline.map(b=>{const m=b.median;return `<article class="baseline-card"><h3>${esc(b.label)}</h3><div class="caption">${esc(b.decoder)}</div><div class="latency">${m?seconds(m.e2e_ms):'—'} <small>${m?'秒 / 视频':statusLabel(b.state)}</small></div><div class="speedup">${m&&reference?(b.id==='BF16'?'参考部署':`相对原版 ${ (reference/m.e2e_ms).toFixed(2)}× · 节省 ${(100*(1-m.e2e_ms/reference)).toFixed(1)}% 时间`):'等待三次测量完成'}</div><div class="metrics"><div><span>DiT</span><b>${m?seconds(m.dit_ms)+' s':'—'}</b></div><div><span>视频解码</span><b>${m?seconds(m.video_vae_ms)+' s':'—'}</b></div><div><span>单卡采样显存峰值</span><b>${b.memory?.max_per_gpu_gib?b.memory.max_per_gpu_gib.toFixed(1)+' GiB':'—'}</b></div><div><span>完成测量</span><b>${b.trials.length} / 3</b></div></div></article>`;}).join('');renderBaselineVideos();
}
function renderBaselineVideos(){
 players.get('baseline-videos')?.dispose();
 const scene=R.baseline_scenes.find(s=>s.id===state.scene);
 $('scene-focus').textContent=scene.focus;
 $('baseline-videos').innerHTML=R.baseline.map(b=>makeVideo({title:b.label,subtitle:'768p · 4 卡',url:b.media?.[state.scene],caption:`${scene.title} · seed 1234`})).join('');attachPlayer('baseline-videos','baseline-player');
}
$('coverage').textContent=`${R.completed_configurations} / 40`;
$('run-status').textContent=statusLabel(R.status.state);
$('updated').textContent='更新于 '+new Date(R.updated_at*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' UTC+8';
$('workload').innerHTML=R.workloads.map(w=>`<option value="${w.id}">${esc(w.label)}</option>`).join('');
$('baseline-scene').innerHTML=R.baseline_scenes.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('');
$('workload').addEventListener('change',e=>{state.workload=e.target.value;renderChart()});
for(const name of ['resolution','decoder'])$(name).querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{state[name]=b.dataset.value;selectSegment(name,state[name]);renderChart()}));
$('stage-gpu').addEventListener('change',e=>{state.stageGpu=Number(e.target.value);renderStages()});
$('gallery-gpu').addEventListener('change',e=>{state.galleryGpu=Number(e.target.value);renderOfficialVideos()});
$('baseline-scene').addEventListener('change',e=>{state.scene=e.target.value;renderBaselineVideos()});
renderChart();renderBaseline();
window.reportUI={state,players,renderChart,renderBaselineVideos};
