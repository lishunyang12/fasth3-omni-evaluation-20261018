(()=>{
 'use strict';
 const report=window.REPORT,q=report.reference_quality,$=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={native:'Native reference size',match:'ComfyUI match',upscaled:'Historical forced upscale'};
 if(!q?.summary){$('rq-decision').textContent='The paired quality analysis is still being prepared.';return;}
 $('rq-decision').textContent='Adoption gate: not passed. Match is faster, but “no quality impact” has not been established by this one-prompt, three-seed pilot.';
 $('rq-metrics').tBodies[0].innerHTML=Object.entries(q.metrics).map(([key,label])=>{
  const delta=q.paired_deltas.match[key];return `<tr data-metric="${key}"><th>${esc(label)}</th>${['native','match','upscaled'].map(p=>`<td>${q.summary[p].metrics[key].mean.toFixed(4)}</td>`).join('')}<td>${delta.mean_difference>=0?'+':''}${delta.mean_difference.toFixed(4)}</td><td>[${delta.ci95.map(v=>v.toFixed(4)).join(', ')}]</td></tr>`;
 }).join('');
 const flow=q.summary.match.metrics.motion_pixels.mean/q.summary.native.metrics.motion_pixels.mean;
 $('rq-motion-note').textContent=`Match has ${(100*(1-flow)).toFixed(1)}% lower mean optical-flow magnitude in this pilot. Its higher temporal similarity therefore cannot be interpreted alone as better quality. Seed-level uncertainty and action completion still matter.`;
 const run=policy=>{const source=q.run_sources[policy];return report[source.group].find(r=>r.id===source.id);};
 $('rq-cost').tBodies[0].innerHTML=['native','match','upscaled'].map(p=>`<tr><th>${labels[p]}</th><td>${q.summary[p].e2e_mean_s.toFixed(2)}</td><td>${q.summary[p].peak_gpu_gib.toFixed(2)}</td><td><a href="${esc(run(p).config_url)}" download>YAML ↓</a></td></tr>`).join('');
 $('rq-review').textContent=q.visual_review?.summary||'Visual review pending. Automated similarity is insufficient to approve a quality-equivalence claim.';
 const order={0:['upscaled','native','match'],1:['match','upscaled','native'],2:['native','match','upscaled']};
 let videos=[],policies=[],frame=0,token=0,playing=false,raf;
 function pause(){playing=false;videos.forEach(v=>v.pause());cancelAnimationFrame(raf);}
 function display(n){frame=Math.min(123,Math.max(0,n));$('rq-frame').value=frame;$('rq-frame-label').textContent=`Frame ${frame} / 123 · ${(frame/24).toFixed(2)} s`;}
 function ready(v,need=2,target=null){
  const okay=()=>v.readyState>=need&&(target===null||!v.seeking&&Math.abs(v.currentTime-target)<.025);
  if(okay())return Promise.resolve();
  return new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(okay()){clearInterval(timer);resolve()}else if(v.error||Date.now()-start>40000){clearInterval(timer);reject(Error('Video loading failed or timed out. Open the original MP4 to inspect it.'))}},80);v.preload='auto';});
 }
 async function seek(n){pause();const current=++token;display(n);const target=(frame+.05)/24;
  try{await Promise.all(videos.map(v=>ready(v,1)));if(current!==token)return;videos.forEach(v=>v.currentTime=target);await Promise.all(videos.map(v=>ready(v,2,target)));if(current===token)$('rq-player-status').textContent=`Paused at frame ${frame}.`;}
  catch(e){if(current===token)$('rq-player-status').textContent=e.message;}
 }
 function tick(){if(!playing)return;const t=videos[0].currentTime;display(Math.floor(t*24));for(const v of videos.slice(1))if(Math.abs(v.currentTime-t)>.08)v.currentTime=t;raf=requestAnimationFrame(tick);}
 async function play(){pause();const current=++token;$('rq-player-status').textContent='Loading three matched videos…';
  try{await Promise.all(videos.map(v=>ready(v)));if(current!==token)return;if(frame>=123)display(0);videos.forEach(v=>v.currentTime=(frame+.05)/24);await Promise.all(videos.map(v=>v.play()));if(current!==token){pause();return;}playing=true;tick();$('rq-player-status').textContent='Playing the same seed under three preprocessing policies.';}
  catch(e){if(current===token)$('rq-player-status').textContent=e.message;}
 }
 function reveal(){const show=$('rq-reveal').checked;policies.forEach((p,i)=>{const card=$('rq-videos').children[i];card.querySelector('h3').textContent=String.fromCharCode(65+i)+(show?' · '+labels[p]:'');card.querySelector('.video-meta').textContent=show?`Reference policy: ${labels[p]}`:'Policy hidden · same deployment and seed';});}
 function render(){pause();token++;for(const v of videos){v.removeAttribute('src');v.load();}const seed=Number($('rq-seed').value);policies=order[seed];const key='images3|480p'+(seed?'|seed'+seed:'');
  $('rq-videos').innerHTML=policies.map((p,i)=>{const url=run(p).media[key];return `<div class="video-card"><h3>${String.fromCharCode(65+i)}</h3><p class="video-meta"></p><div class="rq-viewport"><video muted playsinline preload="metadata" src="${esc(url)}" aria-label="Video ${String.fromCharCode(65+i)}"></video></div><a href="${esc(url)}" download>Original MP4 ${String.fromCharCode(65+i)} ↓</a></div>`;}).join('');
  videos=[...$('rq-videos').querySelectorAll('video')];videos.forEach((v,i)=>{v.muted=i!==Number($('rq-audio').value);v.onended=()=>{pause();display(123)};});display(0);reveal();$('rq-overview').src=`reference-quality/pilot-seed${seed}-overview.jpg`;$('rq-player-status').textContent='Ready. Inspect all three seeds before drawing a conclusion.';
 }
 $('rq-seed').onchange=render;$('rq-reveal').onchange=reveal;$('rq-play').onclick=play;$('rq-pause').onclick=pause;$('rq-prev').onclick=()=>seek(frame-1);$('rq-next').onclick=()=>seek(frame+1);$('rq-frame').oninput=e=>seek(Number(e.target.value));$('rq-audio').onchange=e=>videos.forEach((v,i)=>v.muted=i!==Number(e.target.value));$('rq-zoom').onchange=e=>$('rq-videos').classList.toggle('rq-zoom',e.target.checked);
 window.referenceQualityUI={play,pause,seek,get videos(){return videos},get policies(){return policies}};render();
})();
