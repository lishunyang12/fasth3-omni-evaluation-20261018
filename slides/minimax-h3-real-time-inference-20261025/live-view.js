'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let deck = null, current = 1, checking = false, renderedKey = '', navigation = 0;
  function localURL(path) {
    const url = new URL(path, location.href);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) throw Error('Invalid presentation URL');
    return url;
  }
  function imageURL(slide) {
    const url = localURL(slide.image);
    url.searchParams.set('revision', slide.sha256.slice(0, 16));
    return url.href;
  }
  function hashSlide() {
    const match = /^#slide-(\d+)$/.exec(location.hash);
    return match ? Math.max(1, Number(match[1])) : 1;
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(Error('Slide image could not be loaded'));
      img.src = src;
    });
  }
  async function show(number, updateHash = true) {
    if (!deck) return;
    current = Math.max(1, Math.min(deck.slides.length, number));
    const thisNavigation = ++navigation;
    const slide = deck.slides[current - 1];
    const key = imageURL(slide);
    $('slide-select').value = String(current);
    $('previous').disabled = current === 1;
    $('next').disabled = current === deck.slides.length;
    $('slide-count').textContent = `${current} / ${deck.slides.length}`;
    $('slide-title').textContent = slide.title;
    if (updateHash) history.replaceState(null, '', '#slide-' + current);
    const related = deck.related.filter(r => r.slides.includes(current));
    $('slide-links').replaceChildren(...related.map(r => {
      const a = document.createElement('a'); a.textContent = r.label; a.href = localURL(r.url); return a;
    }));
    document.querySelectorAll('.thumbnail').forEach(b => b.setAttribute('aria-current', String(Number(b.dataset.slide) === current)));
    if (renderedKey !== key) {
      try {
        await loadImage(key);
        if (thisNavigation !== navigation) return;
        $('slide-image').src = key;
        $('slide-image').alt = `Slide ${current}: ${slide.title}`;
        $('slide-image').hidden = false;
        $('open-slide').href = key;
        renderedKey = key;
      } catch (_) {
        if (thisNavigation === navigation) $('sync-status').textContent = 'Slide unavailable. Retrying on the next update.';
      }
    }
  }
  function controls(nextDeck) {
    $('deck-title').textContent = nextDeck.title;
    $('version').textContent = nextDeck.version;
    $('release-date').textContent = new Date(nextDeck.updated_at_utc).toLocaleString();
    $('pptx').href = localURL(nextDeck.downloads.pptx);
    $('pdf').href = localURL(nextDeck.downloads.pdf);
    $('release').href = localURL(nextDeck.release_url);
    $('profile').href = localURL(nextDeck.profile_url);
    $('slide-select').replaceChildren(...nextDeck.slides.map(s => new Option(`${s.number}. ${s.title}`, String(s.number))));
    $('versions').replaceChildren(new Option('Version archive', ''), ...nextDeck.history.map(v => new Option(v.label, v.url)));
    $('thumbnails').replaceChildren(...nextDeck.slides.map(s => {
      const b = document.createElement('button'); b.className = 'thumbnail'; b.dataset.slide = s.number;
      const img = document.createElement('img'); img.src = imageURL(s); img.alt = ''; img.loading = 'lazy'; img.width = 320; img.height = 180;
      const label = document.createElement('span'); label.textContent = `${s.number}. ${s.title}`;
      b.append(img, label); b.addEventListener('click', () => { show(s.number); $('presentation').scrollIntoView({behavior:'smooth'}); });
      return b;
    }));
  }
  function validate(candidate) {
    if (candidate.schema_version !== 1 || !candidate.revision || !Array.isArray(candidate.slides) || !candidate.slides.length) throw Error('Invalid presentation manifest');
    candidate.slides.forEach((s, i) => {
      if (s.number !== i+1 || typeof s.title !== 'string' || !/^[a-f0-9]{64}$/.test(s.sha256)) throw Error('Invalid slide');
      localURL(s.image);
    });
  }
  async function refresh() {
    if (checking) return;
    checking = true;
    try {
      const url = new URL('latest.json', location.href);
      url.searchParams.set('check', Date.now());
      const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw Error('Update check failed');
      const candidate = await response.json(); validate(candidate);
      if (!deck || candidate.revision !== deck.revision) {
        const number = Math.min(deck ? current : hashSlide(), candidate.slides.length);
        // Keep the current presentation if deployment or the network is incomplete.
        await loadImage(imageURL(candidate.slides[number-1]));
        const previousVersion = deck?.version;
        deck = candidate; controls(deck); await show(number);
        $('sync-status').textContent = previousVersion ? `Updated to ${deck.version}. Kept your slide.` : 'Up to date · checks every 30 seconds';
      } else {
        if (renderedKey !== imageURL(deck.slides[current-1])) await show(current);
        $('sync-status').textContent = 'Up to date · checks every 30 seconds';
      }
    } catch (_) {
      $('sync-status').textContent = deck ? `Connection interrupted. Showing ${deck.version}; retrying automatically.` : 'Unable to load the online slides. Use the archived release below or retry.';
    } finally { checking = false; }
  }
  $('previous').addEventListener('click', () => show(current-1));
  $('next').addEventListener('click', () => show(current+1));
  $('slide-select').addEventListener('change', e => show(Number(e.target.value)));
  $('refresh').addEventListener('click', refresh);
  $('versions').addEventListener('change', e => { if (e.target.value) location.href = localURL(e.target.value); });
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('presentation').requestFullscreen(); }
    catch (_) { $('sync-status').textContent = 'Use your browser fullscreen control to present.'; }
  });
  $('copy-link').addEventListener('click', async () => {
    const url = new URL('./', location.href);
    try { await navigator.clipboard.writeText(url.href); $('copy-link').textContent = 'Link copied'; setTimeout(() => $('copy-link').textContent='Copy sharing link', 1800); }
    catch (_) { $('sync-status').textContent = `Share this fixed address: ${url.href}`; }
  });
  window.addEventListener('hashchange', () => show(hashSlide(), false));
  window.addEventListener('keydown', e => {
    if (e.target.closest('select,input,textarea,button,a') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (['ArrowRight','PageDown','ArrowLeft','PageUp','Home','End'].includes(e.key)) {
      e.preventDefault(); show(e.key === 'Home' ? 1 : e.key === 'End' ? deck?.slides.length || 1 : current + (['ArrowRight','PageDown'].includes(e.key) ? 1 : -1));
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  refresh();
})();
