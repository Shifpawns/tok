(() => {
  if (window.top !== window || window.__tok) return;
  if (!/(^|\.)tiktok\.com$/.test(location.hostname)) return;
  window.__tok = true;

  const items = new Map();
  const comments = new Map();
  let currentId = null;
  let enabled = true;
  let commentsOpen = false;
  let pendingSince = 0;
  let lastNav = 0;
  let lastDirection = 1;
  let noIdSince = 0;
  let leavingLive = false;
  let stallTimer = null;
  let urlIndex = 0;
  let urls = [];

  // ---------- data: responses the site loads itself ----------

  function store(url, json) {
    if (!json) return;
    if (Array.isArray(json.itemList)) {
      for (const it of json.itemList) if (it && it.id && it.video) items.set(it.id, it);
    }
    if (url.includes('/comment/list/') && Array.isArray(json.comments)) {
      const id = new URL(url, location.origin).searchParams.get('aweme_id');
      const entry = comments.get(id) || { list: [], seen: new Set(), total: 0 };
      for (const c of json.comments) {
        if (entry.seen.has(c.cid)) continue;
        entry.seen.add(c.cid);
        entry.list.push(c);
      }
      entry.total = json.total || entry.total;
      comments.set(id, entry);
      if (id === currentId) renderComments();
    }
  }

  const wanted = (url) => /\/api\/.*(item_list|comment\/list)/.test(url);

  // the site replaces fetch with its own wrapper later on, so this is re-applied from tick()
  function hookNetwork() {
    if (!window.fetch.__tok) {
      const inner = window.fetch;
      const hooked = function (input) {
        const p = inner.apply(this, arguments);
        try {
          const url = input && input.url ? input.url : String(input);
          if (wanted(url)) p.then((r) => r.clone().json()).then((j) => store(url, j)).catch(() => {});
        } catch (e) {}
        return p;
      };
      hooked.__tok = true;
      window.fetch = hooked;
    }
    if (!XMLHttpRequest.prototype.open.__tok) {
      const inner = XMLHttpRequest.prototype.open;
      const hooked = function (method, url) {
        if (wanted(String(url))) {
          this.addEventListener('load', () => {
            try { store(String(url), JSON.parse(this.responseText)); } catch (e) {}
          });
        }
        return inner.apply(this, arguments);
      };
      hooked.__tok = true;
      XMLHttpRequest.prototype.open = hooked;
    }
  }
  hookNetwork();

  // the site's own players stay silent while our UI is active
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (enabled && !this.dataset.tok) {
      this.muted = true;
      return Promise.resolve();
    }
    return origPlay.apply(this, arguments);
  };

  // ---------- data: items already rendered by the site ----------

  function fiberOf(el) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    return key ? el[key] : null;
  }

  function scanArticles() {
    const found = new Map();
    for (const el of document.querySelectorAll('[data-e2e="feed-video"]')) {
      const seen = new Set();
      let hit = null;
      const look = (o, depth) => {
        if (hit || !o || typeof o !== 'object' || depth > 5 || seen.has(o)) return;
        seen.add(o);
        if (typeof o.id === 'string' && o.video && o.author) { hit = o; return; }
        for (const k of Object.keys(o).slice(0, 50)) {
          try { look(o[k], depth + 1); } catch (e) {}
        }
      };
      let f = fiberOf(el);
      for (let hops = 0; f && hops < 25 && !hit; hops++) {
        look(f.memoizedProps, 0);
        f = f.return;
      }
      if (hit) {
        found.set(hit.id, el.closest('article') || el);
        if (!items.has(hit.id) || hit.video.bitrateInfo) items.set(hit.id, hit);
      }
    }
    return found;
  }

  const nativeId = () => (location.pathname.match(/\/(?:video|photo)\/(\d+)/) || [])[1] || null;

  function nativeKey(key, keyCode) {
    const opts = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true };
    document.body.dispatchEvent(new KeyboardEvent('keydown', opts));
    document.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  // the site only puts the video id in the url once its comment view is open
  function ensureDetailMode() {
    if (nativeId()) return;
    const btn = document.querySelector('[data-e2e="comment-icon"]');
    if (btn) (btn.closest('button') || btn).click();
  }

  // ---------- ui ----------

  const css = `
    #tok { position: fixed; inset: 0; z-index: 2147483647; background: #000; color: #fff;
      font: 14px/1.4 "Segoe UI", system-ui, sans-serif; display: flex; }
    #tok.off { display: none; }
    #tok-stage { flex: 1; position: relative; min-width: 0; display: flex; align-items: center; justify-content: center; }
    #tok-video { max-width: 100%; max-height: 100%; height: 100%; object-fit: contain; background: #000; }
    #tok-images { display: none; height: 100%; overflow-y: auto; }
    #tok-images img { display: block; max-width: 100%; max-height: 100vh; margin: 0 auto 8px; }
    #tok-info { position: absolute; left: 16px; right: 96px; bottom: 16px; text-shadow: 0 1px 3px #000; pointer-events: none; }
    #tok-author { font-weight: 600; margin-bottom: 4px; }
    #tok-desc { max-height: 4.2em; overflow: hidden; opacity: .9; }
    #tok-side { position: absolute; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 10px; text-align: center; }
    #tok-side button { background: rgba(255,255,255,.12); color: #fff; border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer; font: inherit; }
    #tok-side button.on { background: #fe2c55; }
    #tok-status { position: absolute; top: 12px; left: 16px; opacity: .7; font-size: 12px; }
    #tok-comments { width: 360px; border-left: 1px solid #222; display: none; flex-direction: column; background: #111; }
    #tok.comments #tok-comments { display: flex; }
    #tok-comments h3 { margin: 0; padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #222; }
    #tok-clist { flex: 1; overflow-y: auto; padding: 8px 16px; }
    .tok-c { display: flex; gap: 10px; padding: 8px 0; }
    .tok-c img { width: 32px; height: 32px; border-radius: 50%; flex: none; }
    .tok-c b { display: block; font-size: 12px; opacity: .7; font-weight: 600; }
    .tok-c small { opacity: .5; }
  `;

  const root = document.createElement('div');
  root.id = 'tok';
  root.innerHTML = `
    <style>${css}</style>
    <div id="tok-stage">
      <video id="tok-video" data-tok="1" loop playsinline></video>
      <div id="tok-images"></div>
      <div id="tok-status"></div>
      <div id="tok-info"><div id="tok-author"></div><div id="tok-desc"></div></div>
      <div id="tok-side">
        <button id="tok-like"></button>
        <button id="tok-cbtn"></button>
        <button id="tok-mute"></button>
      </div>
    </div>
    <div id="tok-comments"><h3 id="tok-ctitle"></h3><div id="tok-clist"></div></div>
  `;

  const $ = (id) => root.querySelector('#' + id);
  const video = $('tok-video');
  const preload = document.createElement('video');
  preload.dataset.tok = '1';
  preload.preload = 'auto';
  preload.muted = true;

  const short = (n) => {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  };

  function sources(item) {
    const list = (item.video.bitrateInfo || []).filter(
      (b) => b.CodecType === 'h264' && b.PlayAddr && b.PlayAddr.UrlList && b.PlayAddr.UrlList.length
    );
    list.sort((a, b) => b.Bitrate - a.Bitrate);
    if (list.length) return list[0].PlayAddr.UrlList;
    return item.video.playAddr ? [item.video.playAddr] : [];
  }

  function setStatus(text) { $('tok-status').textContent = text || ''; }

  function playCurrent(at) {
    if (!urls.length) return;
    video.src = urls[urlIndex % urls.length];
    if (at) video.currentTime = at;
    origPlay.call(video).catch(() => {
      video.muted = true;
      origPlay.call(video).catch(() => {});
      renderButtons();
    });
  }

  function show(id) {
    const item = items.get(id);
    if (!item) return false;
    currentId = id;
    pendingSince = 0;
    setStatus('');

    const images = item.imagePost && item.imagePost.images;
    $('tok-images').style.display = images ? 'block' : 'none';
    video.style.display = images ? 'none' : '';
    if (images) {
      video.removeAttribute('src');
      video.load();
      $('tok-images').replaceChildren(...images.map((im) => {
        const img = document.createElement('img');
        img.src = (im.imageURL && im.imageURL.urlList && im.imageURL.urlList[0]) || '';
        return img;
      }));
    } else {
      urls = sources(item);
      urlIndex = 0;
      playCurrent(0);
    }

    $('tok-author').textContent = '@' + (item.author.uniqueId || '') + '  ' + (item.author.nickname || '');
    $('tok-desc').textContent = item.desc || '';
    renderButtons();
    renderComments();
    return true;
  }

  function renderButtons() {
    const item = items.get(currentId);
    if (!item) return;
    const stats = item.stats || {};
    $('tok-like').textContent = '♥ ' + short(stats.diggCount);
    $('tok-like').classList.toggle('on', !!item.digged);
    $('tok-cbtn').textContent = '💬 ' + short(stats.commentCount);
    $('tok-mute').textContent = video.muted ? '🔇' : '🔊';
  }

  function renderComments() {
    root.classList.toggle('comments', commentsOpen);
    if (!commentsOpen) return;
    const entry = comments.get(currentId);
    const list = entry ? entry.list : [];
    $('tok-ctitle').textContent = 'Comments' + (entry ? ' (' + short(entry.total) + ')' : '');
    const nodes = list.map((c) => {
      const row = document.createElement('div');
      row.className = 'tok-c';
      const img = document.createElement('img');
      const thumbs = c.user && c.user.avatar_thumb && c.user.avatar_thumb.url_list;
      if (thumbs && thumbs[0]) img.src = thumbs[0];
      const body = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = (c.user && (c.user.nickname || c.user.unique_id)) || '';
      const text = document.createElement('div');
      text.textContent = c.text || '';
      const meta = document.createElement('small');
      meta.textContent = '♥ ' + short(c.digg_count) + (c.reply_comment_total ? '  ·  ' + c.reply_comment_total + ' replies' : '');
      body.append(name, text, meta);
      row.append(img, body);
      return row;
    });
    if (!nodes.length) {
      const empty = document.createElement('div');
      empty.style.opacity = '.6';
      empty.textContent = 'Loading comments... press R to retry';
      nodes.push(empty);
    }
    $('tok-clist').replaceChildren(...nodes);
  }

  // comments come from the site's own panel, so loading more means scrolling that panel
  function nativeCommentScroller() {
    let el = document.querySelector('[data-e2e="comment-level-1"]');
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 20) return el;
      el = el.parentElement;
    }
    return null;
  }

  function loadMoreComments() {
    const scroller = nativeCommentScroller();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function retryComments() {
    const scroller = nativeCommentScroller();
    if (scroller) {
      scroller.scrollTop = 0;
      setTimeout(loadMoreComments, 200);
    } else {
      go(1);
      setTimeout(() => go(-1), 700);
    }
  }

  // ---------- actions ----------

  function go(direction) {
    const now = Date.now();
    if (now - lastNav < 250) return;
    lastNav = now;
    lastDirection = direction;
    ensureDetailMode();
    const btn = document.querySelector(`[data-e2e="feed-navigation-${direction > 0 ? 'next' : 'prev'}"]`);
    if (btn && !btn.disabled) btn.click();
    else if (direction > 0) nativeKey('ArrowDown', 40);
    else nativeKey('ArrowUp', 38);
  }

  function like() {
    const article = scanArticles().get(currentId);
    const icon = article && article.querySelector('[data-e2e="like-icon"]');
    if (!icon) return;
    (icon.closest('button') || icon).click();
    const item = items.get(currentId);
    item.digged = !item.digged;
    if (item.stats) item.stats.diggCount += item.digged ? 1 : -1;
    renderButtons();
  }

  function toggleMute() {
    video.muted = !video.muted;
    renderButtons();
  }

  function toggleComments() {
    commentsOpen = !commentsOpen;
    renderComments();
  }

  function setEnabled(value) {
    enabled = value;
    root.classList.toggle('off', !enabled);
    if (enabled) {
      if (currentId) origPlay.call(video).catch(() => {});
    } else {
      video.pause();
    }
  }

  // ---------- stall recovery ----------

  function armStall() {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      if (!enabled || video.paused || video.readyState >= 3) return;
      urlIndex++;
      playCurrent(video.currentTime);
    }, 4000);
  }
  video.addEventListener('waiting', armStall);
  video.addEventListener('stalled', armStall);
  video.addEventListener('playing', () => clearTimeout(stallTimer));
  video.addEventListener('error', () => {
    if (urlIndex + 1 < urls.length) {
      urlIndex++;
      playCurrent(0);
    } else {
      setStatus('Video failed to load, skipping');
      setTimeout(() => go(1), 800);
    }
  });

  // ---------- input ----------

  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted) return;
    if (e.key === 'F2') {
      e.preventDefault();
      e.stopImmediatePropagation();
      setEnabled(!enabled);
      return;
    }
    if (!enabled || e.ctrlKey || e.altKey || e.metaKey) return;
    const actions = {
      ArrowDown: () => go(1), j: () => go(1),
      ArrowUp: () => go(-1), k: () => go(-1),
      ' ': () => (video.paused ? origPlay.call(video).catch(() => {}) : video.pause()),
      m: toggleMute, c: toggleComments, l: like, r: retryComments,
      ArrowRight: () => { video.currentTime += 5; },
      ArrowLeft: () => { video.currentTime -= 5; },
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    action();
  }, true);

  root.addEventListener('wheel', (e) => {
    if (e.target.closest('#tok-comments, #tok-images')) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) > 20) go(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  root.addEventListener('click', (e) => {
    const id = e.target.id;
    if (id === 'tok-like') like();
    else if (id === 'tok-cbtn') toggleComments();
    else if (id === 'tok-mute') toggleMute();
    else if (id === 'tok-video') video.paused ? origPlay.call(video).catch(() => {}) : video.pause();
  });

  $('tok-clist').addEventListener('scroll', (e) => {
    const el = e.target;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) loadMoreComments();
  });

  // ---------- main loop: follow whatever video the site is on ----------

  function tick() {
    if (!document.body) return;
    if (!root.isConnected) document.body.appendChild(root);
    hookNetwork();
    if (!enabled) return;

    // live streams in the feed open their own page; step back out and move on
    if (/\/live\b/.test(location.pathname)) {
      if (!leavingLive) { leavingLive = true; history.back(); }
      return;
    }
    leavingLive = false;

    const id = nativeId();
    if (!id) {
      if (!noIdSince) noIdSince = Date.now();
      if (!currentId) {
        ensureDetailMode();
        setStatus('Loading feed... (F2 for the normal site, e.g. to log in)');
      } else if (Date.now() - noIdSince > 1200) {
        noIdSince = 0;
        go(lastDirection);
      }
      return;
    }
    noIdSince = 0;
    if (id === currentId) return;

    const found = scanArticles();
    if (show(id)) {
      const ids = [...found.keys()];
      const next = items.get(ids[ids.indexOf(id) + 1]);
      if (next && !next.imagePost) {
        const nextUrls = sources(next);
        if (nextUrls[0]) preload.src = nextUrls[0];
      }
    } else {
      if (!pendingSince) pendingSince = Date.now();
      setStatus('Loading...');
      if (Date.now() - pendingSince > 6000) { pendingSince = 0; go(1); }
    }
  }

  setInterval(tick, 150);
})();
