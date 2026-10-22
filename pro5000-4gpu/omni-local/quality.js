'use strict';
window.renderAttentionQuality=(rows,g,d,res)=>{
 window.qualityPlayer?.dispose();
 const byId=id=>document.getElementById(id),seed=Number(byId('quality-seed').value),key=`image|${res}${seed?'|seed'+seed:''}`;
 const host=byId('attention-videos'),status=byId('quality-status');
 host.innerHTML=rows.map((x,i)=>{
  const url=x.r?.media?.[key],scope=x.mode==='vsa-sage2'&&(g!==4||d!=='8l');
  return `<div class="video-card pro-card" data-quality-index="${i}"><h4>${esc(x.label)}</h4><p class="video-meta">${g} GPU · ${res} · ${d.toUpperCase()} · seed ${seed}</p>${url?`<div class="quality-viewport"><video muted playsinline preload="metadata" src="${esc(url)}" aria-label="${esc(x.label)}"></video></div><div class="quality-links"><a class="download" href="${esc(url)}" download>Original MP4 ↓</a><button type="button" class="quality-expand" data-index="${i}">Enlarge ↗</button></div>`:`<div class="empty-video"><strong>${scope?'Outside Sage2 sample scope':'Awaiting measured output'}</strong><span>${scope?'Sage2: select 4 GPUs and the Fast 8L decoder.':'This slot appears after the matched request completes.'}</span></div>`}</div>`;
 }).join('');
 const videos=[...host.querySelectorAll('video')],titles=videos.map(v=>v.closest('.video-card').querySelector('h4').textContent);
 byId('quality-player').innerHTML=`<button id="quality-play" type="button">Play together</button><button id="quality-pause" type="button">Pause</button><button id="quality-prev" type="button" aria-label="Previous frame">← Frame</button><button id="quality-next" type="button" aria-label="Next frame">Frame →</button><label>Audio <select id="quality-audio"><option value="-1">Mute all</option>${titles.map((t,i)=>`<option value="${i}">${esc(t)}</option>`).join('')}</select></label><label>Detail <select id="quality-zoom"><option value="1">Full frame</option><option value="2">2× center crop</option></select></label><input id="quality-timeline" type="range" min="0" max="123" step="1" value="0" aria-label="Quality comparison frame"><output id="quality-frame">Frame 0 / 123 · 0.00 s</output>`;
 const slider=byId('quality-timeline'),display=byId('quality-frame');let frame=0,playing=false,dead=false,raf=null,operation=0;
 const update=f=>{frame=Math.max(0,Math.min(123,f));slider.value=frame;display.textContent=`Frame ${frame} / 123 · ${(frame/24).toFixed(2)} s`;};
 const pause=()=>{operation++;playing=false;videos.forEach(v=>v.pause());cancelAnimationFrame(raf);};
 const ready=v=>v.readyState>=2?Promise.resolve():new Promise((resolve,reject)=>{
  const clean=()=>{clearTimeout(timeout);v.removeEventListener('loadeddata',done);v.removeEventListener('error',fail)};
  const done=()=>{clean();resolve()},fail=()=>{clean();reject(Error('A video could not load. Retry or open its original MP4.'))};
  const timeout=setTimeout(()=>{clean();reject(Error('Video loading timed out. Retry or open its original MP4.'))},45000);
  v.addEventListener('loadeddata',done,{once:true});v.addEventListener('error',fail,{once:true});v.preload='auto';
 });
 const seek=async f=>{pause();update(f);const token=operation;try{await Promise.all(videos.map(ready));if(dead||token!==operation)return;videos.forEach(v=>v.currentTime=(frame+.05)/24);status.textContent=`Paused at frame ${frame}; compare face, hands, edges and motion continuity.`}catch(e){if(!dead)status.textContent=e.message}};
 const tick=()=>{if(dead||!playing)return;const t=videos[0].currentTime;update(Math.floor(t*24));for(const v of videos.slice(1))if(Math.abs(v.currentTime-t)>.08)v.currentTime=t;raf=requestAnimationFrame(tick)};
 const play=async()=>{pause();const token=operation;byId('quality-play').disabled=true;status.textContent='Loading matched videos…';try{await Promise.all(videos.map(ready));if(dead||token!==operation)return;if(frame>=123)update(0);videos.forEach(v=>v.currentTime=(frame+.05)/24);await Promise.all(videos.map(v=>v.play()));if(dead||token!==operation){videos.forEach(v=>v.pause());return}playing=true;status.textContent=`Playing ${videos.length} matched outputs · seed ${seed}. Pause and step through frames to inspect detail.`;tick()}catch(e){pause();if(!dead)status.textContent=e.message}finally{if(!dead)byId('quality-play').disabled=false}};
 byId('quality-play').onclick=play;byId('quality-pause').onclick=()=>{pause();status.textContent='Paused. Use frame controls to compare the same moment.'};
 byId('quality-prev').onclick=()=>seek(frame-1);byId('quality-next').onclick=()=>seek(frame+1);slider.oninput=()=>seek(Number(slider.value));
 byId('quality-audio').onchange=e=>videos.forEach((v,i)=>v.muted=i!==Number(e.target.value));
 byId('quality-zoom').onchange=e=>host.classList.toggle('zoom-detail',e.target.value==='2');host.classList.remove('zoom-detail');
 videos.forEach(v=>v.addEventListener('ended',()=>{pause();update(123)}));
 host.querySelectorAll('.quality-expand').forEach(button=>button.onclick=async()=>{pause();const card=button.closest('.video-card');if(card.requestFullscreen)try{await card.requestFullscreen()}catch(e){status.textContent='Full screen unavailable; use the original MP4 link.'}});
 byId('quality-play').disabled=videos.length===0;byId('quality-prev').disabled=videos.length===0;byId('quality-next').disabled=videos.length===0;slider.disabled=videos.length===0;
 status.textContent=`${videos.length} / ${rows.length} outputs available · seed ${seed}. Same request and decoder; inspect individual samples without inferring an overall quality ranking.`;
 window.qualityPlayer={videos,play,pause,seek,dispose(){dead=true;pause();videos.forEach(v=>{v.removeAttribute('src');v.load()})}};
};
