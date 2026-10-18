'use strict';
const metrics={latency:{v:[41.06381247518584,39.642830790020525],max:45,unit:'s',note:'柱形从零起算；降低 3.4604%。每组 3 次正常完整请求，固定 124 帧 seed43。'},memory:{v:[35.150390625,59.642578125],max:70,unit:'GiB',note:'柱形从零起算；每卡 peak reserved 增加 24.492188 GiB。这是预留显存，不是仅权重大小。'},rx:{v:[456.395152092,260.797229767],max:500,unit:'GiB',note:'柱形从零起算；每卡每请求逻辑接收量降低 42.8571%。由权重字节数推算，非网络计数器实测；不含协议开销。'}};
const select=document.getElementById('metric');
function updateChart(){const m=metrics[select.value];[8,2].forEach((n,i)=>{document.getElementById('bar'+n).style.width=(100*m.v[i]/m.max)+'%';document.getElementById('value'+n).textContent=m.v[i].toFixed(3)+' '+m.unit;});document.getElementById('chart-note').textContent=m.note;}
select.addEventListener('change',updateChart);updateChart();
const search=document.getElementById('report-search'),cards=[...document.querySelectorAll('.report-item')];
search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();let n=0;cards.forEach(c=>{c.hidden=!c.textContent.toLowerCase().includes(q);if(!c.hidden)n++;});document.getElementById('report-count').textContent=`显示 ${n} / ${cards.length} 份报告`;});
