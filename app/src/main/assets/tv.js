/*
 * Stream TV – remote control layer injected into the JioHotstar website.
 *  - Arrow keys move a focus ring between tiles, menus and buttons
 *  - OK clicks the focused item
 *  - In the video player: OK = play/pause, Left/Right = seek,
 *    Up/Down = reach the player buttons (audio, quality, episodes…)
 *  - Back closes menus / leaves player buttons / goes back a page
 *  - Pushes the player to the highest available quality
 */
(function () {
  if (window.__tv) return;
  var tv = (window.__tv = {});
  var native = window.TVNative || null;

  /* ------------------------------------------------ 1. highest quality */

  // Video quality – chosen in the Stream TV menu (hold OK), saved on the TV.
  //   1080 (default) : 1080p H.264, smooth on the Chromecast
  //   4k             : everything the site offers (4K / HEVC / Dolby Vision)
  //   720 / 480      : lower caps for slow VPN connections
  var QUALITIES = [
    { id: '1080', label: 'Full HD 1080p  (recommended)', maxH: 1080, heavy: false },
    { id: '4k',   label: '4K / HDR  (may stutter)',     maxH: 2160, heavy: true },
    { id: '720',  label: 'HD 720p',                     maxH: 720,  heavy: false },
    { id: '480',  label: 'SD 480p  (slow connection)',  maxH: 480,  heavy: false }
  ];
  function getQuality() {
    var id = '1080';
    try { id = localStorage.getItem('streamtv.quality') || '1080'; } catch (e) {}
    for (var i = 0; i < QUALITIES.length; i++) if (QUALITIES[i].id === id) return QUALITIES[i];
    return QUALITIES[0];
  }
  var Q = getQuality();
  var HEAVY = /av01|av1|hev1|hvc1|hevc|dvh1|dvhe|dvav|dva1|vp09/i;
  function codecBlocked(t) { return !Q.heavy && HEAVY.test(t || ''); }
  function heavyCfg(cfg) {
    var v = cfg && cfg.video;
    if (!v) return false;
    if (codecBlocked(v.contentType)) return true;
    return (v.height || 0) > Q.maxH || (v.width || 0) > Math.round(Q.maxH * 16 / 9) + 8;
  }
  try {
    if (window.MediaSource && MediaSource.isTypeSupported) {
      var its = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = function (t) { return codecBlocked(t) ? false : its(t); };
    }
  } catch (e) {}
  try {
    var cpt = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (t) { return codecBlocked(t) ? '' : cpt.call(this, t); };
  } catch (e) {}
  try {
    var mc = navigator.mediaCapabilities;
    if (mc && mc.decodingInfo) {
      var di = mc.decodingInfo.bind(mc);
      mc.decodingInfo = function (cfg) {
        if (heavyCfg(cfg)) {
          return Promise.resolve({ supported: false, smooth: false, powerEfficient: false,
                                   keySystemAccess: null, configuration: cfg });
        }
        return di(cfg);
      };
    }
  } catch (e) {}
  try {
    if (navigator.requestMediaKeySystemAccess) {
      var rmk = navigator.requestMediaKeySystemAccess.bind(navigator);
      navigator.requestMediaKeySystemAccess = function (ks, configs) {
        try {
          var kept = [];
          (configs || []).forEach(function (c) {
            var n = Object.assign({}, c);
            if (n.videoCapabilities) {
              n.videoCapabilities = n.videoCapabilities.filter(function (v) {
                return !codecBlocked(v.contentType);
              });
              if (!n.videoCapabilities.length) return;
            }
            kept.push(n);
          });
          if (kept.length) configs = kept;
        } catch (e) {}
        return rmk(ks, configs);
      };
    }
  } catch (e) {}

  // Audio languages of the current title, read from the site's own API
  // responses (settings → audio_language_list → audio_filer).
  var langInfo = { list: null, prefId: null, path: null };
  function scanForLangs(text) {
    if (!text || (text.indexOf('audio_filer') < 0 && text.indexOf('user_language_preference_id') < 0)) return;
    var j;
    try { j = JSON.parse(text); } catch (e) { return; }
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 40) return;
      if (Array.isArray(o.audio_filer)) {
        var list = o.audio_filer.filter(function (x) { return x && (x.iso3code || x.iso2code); })
          .map(function (x) {
            return { name: x.name || x.title || x.iso3code, iso3code: x.iso3code, iso2code: x.iso2code,
                     note: x.description || '', raw: x };
          });
        if (list.length) { langInfo.list = list; langInfo.path = location.pathname; }
      }
      if (o.user_language_preference_id) langInfo.prefId = String(o.user_language_preference_id);
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) walk(o[k], depth + 1);
    })(j, 0);
  }
  try {
    var ofetch = window.fetch;
    window.fetch = function (input) {
      var p = ofetch.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\/api\//.test(url)) {
          p.then(function (r) {
            try { r.clone().text().then(scanForLangs).catch(function () {}); } catch (e) {}
          }).catch(function () {});
        }
      } catch (e) {}
      return p;
    };
  } catch (e) {}
  try {
    var oopen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, url) {
      if (/\/api\//.test(String(url || ''))) {
        this.addEventListener('load', function () {
          try { if (!this.responseType || this.responseType === 'text') scanForLangs(this.responseText); } catch (e) {}
        });
      }
      return oopen.apply(this, arguments);
    };
  } catch (e) {}

  // Start at a high (but realistic) bitrate; the player still adapts to the
  // real line speed after that.
  try {
    var conn = {
      downlink: Q.maxH >= 2160 ? 60 : Q.maxH >= 1080 ? 25 : Q.maxH >= 720 ? 8 : 3, downlinkMax: Infinity, effectiveType: '4g', rtt: 50,
      saveData: false, type: 'ethernet', onchange: null,
      addEventListener: function () {}, removeEventListener: function () {},
      dispatchEvent: function () { return true; }
    };
    Object.defineProperty(Navigator.prototype, 'connection', {
      get: function () { return conn; }, configurable: true
    });
  } catch (e) {}

  // Report a screen that matches the chosen quality.
  try {
    var SW = Math.round(Q.maxH * 16 / 9), SH = Q.maxH;
    ['width', 'availWidth'].forEach(function (k) {
      Object.defineProperty(Screen.prototype, k, { get: function () { return SW; }, configurable: true });
    });
    ['height', 'availHeight'].forEach(function (k) {
      Object.defineProperty(Screen.prototype, k, { get: function () { return SH; }, configurable: true });
    });
  } catch (e) {}

  var HIGH_BW = Q.maxH >= 2160 ? 40e6 : Q.maxH >= 1080 ? 15e6 : Q.maxH >= 720 ? 6e6 : 2.5e6;

  function boostPlayers() {
    // Shaka Player (if the site exposes it)
    try {
      var s = window.shaka;
      if (s && s.Player && !s.Player.prototype.__tvBoost) {
        var orig = s.Player.prototype.configure;
        s.Player.prototype.configure = function () {
          var r = orig.apply(this, arguments);
          if (!this.__tvBoosted) {
            this.__tvBoosted = true;
            try {
              orig.call(this, {
                abr: { defaultBandwidthEstimate: HIGH_BW, restrictToElementSize: false, restrictToScreenSize: false }
              });
            } catch (e) {}
          }
          return r;
        };
        s.Player.prototype.__tvBoost = true;
      }
    } catch (e) {}
    // hls.js (if the site exposes it)
    try {
      var Hls = window.Hls;
      if (Hls && Hls.DefaultConfig && !Hls.__tvBoost) {
        Hls.DefaultConfig.abrEwmaDefaultEstimate = HIGH_BW;
        Hls.DefaultConfig.capLevelToPlayerSize = false;
        Hls.__tvBoost = true;
      }
    } catch (e) {}
  }
  boostPlayers();
  setInterval(boostPlayers, 1500);

  /* ------------------------------------------------ 2. focus ring + OSD */

  var ring = document.createElement('div');
  ring.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483647;display:none;box-sizing:border-box;' +
    'border:3px solid #fff;border-radius:10px;' +
    'box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 22px 2px rgba(255,255,255,.45);' +
    'transition:left .12s ease-out,top .12s ease-out,width .12s ease-out,height .12s ease-out;';

  var osd = document.createElement('div');
  osd.style.cssText =
    'position:fixed;left:50%;bottom:9%;transform:translateX(-50%);z-index:2147483647;' +
    'pointer-events:none;display:none;padding:10px 22px;border-radius:24px;' +
    'background:rgba(0,0,0,.72);color:#fff;font:600 20px/1.2 system-ui,sans-serif;' +
    'letter-spacing:.3px;white-space:nowrap;';
  var osdTimer = 0;

  function overlayParent() {
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs && fs.tagName !== 'VIDEO') return fs;
    return document.body || document.documentElement;
  }
  function attachOverlays() {
    var p = overlayParent();
    if (!p) return;
    if (ring.parentNode !== p) p.appendChild(ring);
    if (osd.parentNode !== p) p.appendChild(osd);
    if (typeof bar !== 'undefined' && bar && bar.parentNode && bar.parentNode !== p) p.appendChild(bar);
  }
  document.addEventListener('fullscreenchange', function () { attachOverlays(); place(); }, true);

  function showOsd(text) {
    attachOverlays();
    osd.textContent = text;
    osd.style.display = 'block';
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osd.style.display = 'none'; }, 1600);
  }

  var cur = null;          // currently focused element
  var ringHidden = false;  // hidden while watching video

  function place() {
    if (!cur || !cur.isConnected || ringHidden) { ring.style.display = 'none'; return; }
    var r = cur.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) { ring.style.display = 'none'; return; }
    attachOverlays();
    ring.style.left = (r.left - 5) + 'px';
    ring.style.top = (r.top - 5) + 'px';
    ring.style.width = (r.width + 10) + 'px';
    ring.style.height = (r.height + 10) + 'px';
    ring.style.display = 'block';
  }
  // keep the ring glued to its element while the page scrolls/animates
  var burstUntil = 0;
  function burst(ms) {
    var start = !burstUntil || performance.now() > burstUntil;
    burstUntil = Math.max(burstUntil, performance.now() + (ms || 500));
    if (start) (function loop() {
      place();
      if (performance.now() < burstUntil) requestAnimationFrame(loop);
      else burstUntil = 0;
    })();
  }
  window.addEventListener('scroll', function () { burst(250); }, true);
  window.addEventListener('resize', function () { burst(300); });
  setInterval(place, 700);

  /* ------------------------------------------------ 3. what can be focused */

  var SEL = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],' +
    '[role=menuitem],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch],' +
    '[tabindex]:not([tabindex="-1"]),[onclick]';
  var POINTER_SEL = 'div,span,li,img,article,section,figure,picture,p,h1,h2,h3,h4,h5,svg,label';

  var cache = null, cacheAt = 0, dirty = true;
  try {
    new MutationObserver(function () { dirty = true; })
      .observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  function isText(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'email', 'tel', 'number', 'password', 'url'].indexOf(t) >= 0;
  }

  // The layer the user is looking at: an open dialog, the full-screen player,
  // or any fixed layer (pop-up, player page) covering the middle of the screen.
  // Navigation never leaves this layer, so it can't jump to the page behind.
  function scopeRoot() {
    var vw = innerWidth, vh = innerHeight;
    var dlg = document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open]');
    for (var i = dlg.length - 1; i >= 0; i--) {
      var r = dlg[i].getBoundingClientRect();
      if (r.width > 40 && r.height > 40 && getComputedStyle(dlg[i]).visibility !== 'hidden') return dlg[i];
    }
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs && fs.tagName !== 'VIDEO') return fs;
    var hit = document.elementFromPoint(vw / 2, vh / 2);
    var layer = null;
    for (var e = hit; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (getComputedStyle(e).position === 'fixed') {
        var b = e.getBoundingClientRect();
        if (b.width * b.height >= vw * vh * 0.4) layer = e;   // keep the outermost
      }
    }
    return layer || document;
  }

  var CLICK_EVT = /^(click|mousedown|mouseup|pointerdown|pointerup)(true|false)$/;
  function hasReactClick(e) {
    // Preact (used by JioHotstar) keeps its listeners in el.l
    var l = e.l;
    if (l && typeof l === 'object') {
      for (var n in l) if (CLICK_EVT.test(n)) return true;
    }
    var keys = Object.keys(e);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf('__reactProps$') === 0 || k.indexOf('__reactEventHandlers$') === 0) {
        var p = e[k];
        return !!(p && (p.onClick || p.onMouseUp || p.onPointerUp || p.onMouseDown || p.onPointerDown));
      }
    }
    return false;
  }

  var EXPLICIT = 'A,BUTTON,INPUT,SELECT,TEXTAREA,SUMMARY';
  function isExplicit(e) {
    return EXPLICIT.indexOf(e.tagName) >= 0 || /button|link|tab|menuitem|option|checkbox|radio|switch/
      .test(e.getAttribute('role') || '');
  }

  function collect() {
    var root = scopeRoot();
    var now = performance.now();
    if (cache && !dirty && cache.root === root && now - cacheAt < 1500) return cache.list;
    var set = new Set();
    root.querySelectorAll(SEL).forEach(function (e) {
      if (!e.disabled && e.getAttribute('aria-disabled') !== 'true') set.add(e);
    });
    var all = root.querySelectorAll(POINTER_SEL);
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (set.has(e)) continue;
      // React click handler (how the site makes its tiles clickable) …
      if (hasReactClick(e)) { set.add(e); continue; }
      // … or the outermost element that shows a hand cursor
      if (getComputedStyle(e).cursor !== 'pointer') continue;
      var p = e.parentElement;
      if (p && getComputedStyle(p).cursor === 'pointer') continue;
      set.add(e);
    }
    set.delete(ring); set.delete(osd);
    // Row scroll arrows sit on top of the first/last tile: never stop on them,
    // the focus pages the row itself.
    set.forEach(function (e) {
      if (isRowArrow(e) || isRowHeader(e)) set.delete(e);
    });

    // One stop per title: tidy up nested clickables.
    var kids = new Map();                      // ancestor -> candidate descendants
    set.forEach(function (e) {
      for (var a = e.parentElement; a; a = a.parentElement) {
        if (set.has(a)) {
          if (!kids.has(a)) kids.set(a, []);
          kids.get(a).push(e);
        }
      }
    });
    var drop = new Set();
    var screenArea = innerWidth * innerHeight;
    kids.forEach(function (list, a) {
      var ar = a.getBoundingClientRect(), aArea = ar.width * ar.height || 1, sum = 0;
      list.forEach(function (k) { var r = k.getBoundingClientRect(); sum += r.width * r.height; });
      if (sum >= aArea * 0.5 && list.length >= 2) {
        drop.add(a);                            // a row/group wrapper: keep the items
      } else if (aArea < screenArea * 0.15) {
        list.forEach(function (k) { drop.add(k); });  // a title tile: one stop, drop its parts
      } else {
        // a big banner: its own buttons (Watch, +Watchlist…) are the stops
        var explicitKids = list.filter(isExplicit);
        if (explicitKids.length) drop.add(a);
        list.forEach(function (k) { if (!isExplicit(k)) drop.add(k); });
      }
    });
    var list = [];
    set.forEach(function (e) { if (!drop.has(e)) list.push(e); });
    cache = { root: root, list: list };
    cacheAt = now;
    dirty = false;
    return list;
  }

  // Is the element actually visible: not hidden/faded (itself or a parent)
  // and, when on screen, not covered by a pop-up or panel?
  function usable(e, r, vw, vh) {
    if (!e.isConnected) return false;
    if (r.width < 8 || r.height < 8) return false;
    if (r.width * r.height > vw * vh * 0.6) return false; // page wrappers
    if (r.bottom < -vh * 3 || r.top > vh * 4) return false;
    var cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    for (var p = e, i = 0; p && i < 14; p = p.parentElement, i++) {
      if (parseFloat(getComputedStyle(p).opacity) < 0.05) return false;
    }
    return !covered(e, r, vw, vh);
  }

  // Row titles and "View All" links sit above each row on the left; stopping
  // on them made Down jump sideways. Rows are reached through their titles.
  function isRowHeader(e) {
    var wrap = e.closest && e.closest('[data-testid="tray-container-base-wrapper"]');
    if (!wrap) return false;
    return !e.closest('[data-testid="tray-container"]');
  }

  function isRowArrow(e) {
    var c = (typeof e.className === 'string') ? e.className : '';
    return /swiper-button-(next|prev)|carousel-(next|prev)|arrow-(left|right)/i.test(c);
  }

  function hitOk(e, x, y) {
    var hs = document.elementsFromPoint(x, y), h = null;
    for (var i = 0; i < hs.length; i++) {
      if (hs[i] === ring || hs[i] === osd || isRowArrow(hs[i])) continue;
      h = hs[i]; break;
    }
    if (!h) return true;
    return h === e || e.contains(h) || h.contains(e);
  }

  // --- rows built with Swiper: tiles past the edge are paged in by its arrows
  function rowOf(e) { return e.closest ? e.closest('.swiper-container,.swiper') : null; }
  function rowArrow(row, dir) {
    var b = row && row.querySelector(dir === 'right' ? '.swiper-button-next' : '.swiper-button-prev');
    if (!b || b.disabled || /disabled/.test(b.className)) return null;
    return b;
  }
  function pageRowTo(e, tries) {
    var row = rowOf(e);
    if (!row || !e.isConnected) return;
    var r = e.getBoundingClientRect(), rr = row.getBoundingClientRect();
    var dir = r.right > rr.right + 2 ? 'right' : (r.left < rr.left - 2 ? 'left' : null);
    if (!dir) { burst(500); return; }
    var b = rowArrow(row, dir);
    if (!b) return;
    b.click();
    if ((tries || 0) < 8) setTimeout(function () { pageRowTo(e, (tries || 0) + 1); }, 380);
  }

  function covered(e, r, vw, vh) {
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 1 || y < 1 || x > vw - 1 || y > vh - 1) return false; // off screen: can't tell
    if (hitOk(e, x, y)) return false;
    // allow small badges over the centre: try two more points
    return !hitOk(e, r.left + r.width * 0.25, r.top + r.height * 0.3) &&
           !hitOk(e, r.left + r.width * 0.75, r.top + r.height * 0.7);
  }

  /* ------------------------------------------------ 4. moving the focus */

  // Page scrolling like a TV app: the page only moves when the focused item
  // would leave the screen, and then just enough to show it with its row
  // title, near the top. Near the top of the page it snaps back to the top.
  var stickyX = null;
  function scrollerFor(e) {
    for (var p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
    }
    return null;
  }
  function revealVertically(e, dir) {
    var r = e.getBoundingClientRect(), vh = innerHeight;
    var topGap = Math.min(110, vh * 0.2), bottomGap = 24;
    var sc = scrollerFor(e);
    var delta = 0;
    if (r.bottom > vh - bottomGap || r.top < topGap * 0.5) {
      delta = r.top - topGap;                      // put its row near the top
    } else if (dir === 'up' && window.scrollY > 0 && r.bottom + window.scrollY < vh - bottomGap) {
      delta = -window.scrollY;                     // back at the top area: show it whole
    }
    if (!delta) return;
    if (sc) {
      var target = sc.scrollTop + delta;
      sc.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      return;
    }
    var y = window.scrollY + delta;
    // anything that fits on the first screen: show the page from the top
    if (r.bottom + window.scrollY < vh - bottomGap || y < vh * 0.35) y = 0;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  var lastByPath = {};
  var autoFocused = false;   // focus was placed by us, not by a key press
  function autoFocus(e) { setFocus(e, null); autoFocused = true; }
  function setFocus(e, dir) {
    cur = e;
    autoFocused = false;
    if (dir) lastByPath[location.pathname] = e;   // only titles the user moved to
    ringHidden = false;
    try {
      if (e.tabIndex >= 0 || isText(e)) e.focus({ preventScroll: true });
      else if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();   // clear the site's own outline from the last item
      }
    } catch (x) {}
    if (dir === 'left' || dir === 'right') {
      var rr = e.getBoundingClientRect();
      stickyX = rr.left + rr.width / 2;           // remember the column
    }
    var row = rowOf(e);
    if (row) row.scrollLeft = 0;                   // Swiper rows page with their arrows
    revealVertically(e, dir);
    if (!row && (dir === 'left' || dir === 'right')) {
      try { e.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } catch (x) {}
    }
    burst(700);
    if (dir === 'left' || dir === 'right') setTimeout(function () { pageRowTo(e, 0); }, 60);
  }

  var PRIMARY = /^(watch|play|resume|continue|start|subscribe to watch)/i;
  function firstInView() {
    var vw = innerWidth, vh = innerHeight, best = null, bs = Infinity;
    var titlePage = /\/(shows|movies|sports|live|tv)\/[^/]+\/\d+/.test(location.pathname);
    collect().forEach(function (e) {
      var r = e.getBoundingClientRect();
      if (!usable(e, r, vw, vh)) return;
      if (r.top < 0 || r.left < 0 || r.top > vh || r.left > vw) return;
      var s = r.top * 2 + r.left;
      // On a title page start on its main button (Watch / Play / Resume…)
      var label = (e.getAttribute('aria-label') || e.textContent || '').trim();
      if (titlePage && isExplicit(e) && PRIMARY.test(label)) s -= 5000;
      if (s < bs) { bs = s; best = e; }
    });
    return best;
  }

  // Is the element horizontally on screen and not clipped away inside a
  // scrolled carousel?
  function visibleX(e, b, vw) {
    var cx = b.left + b.width / 2;
    if (cx < 0 || cx > vw) return false;
    var p = e.parentElement;
    for (var i = 0; p && i < 10; i++, p = p.parentElement) {
      var ox = getComputedStyle(p).overflowX;
      if (ox !== 'visible') {
        var pr = p.getBoundingClientRect();
        if (cx < pr.left || cx > pr.right) return false;
      }
    }
    return true;
  }

  // A pop-up opened over the focused item (or it faded away): forget it so
  // focus starts again inside whatever is on top now.
  function validateCur() {
    if (!cur) return;
    if (!cur.isConnected) { cur = null; return; }
    var root = scopeRoot();
    if ((root !== document && !root.contains(cur)) ||
        !usable(cur, cur.getBoundingClientRect(), innerWidth, innerHeight)) {
      saved = cur;            // remember it for when the pop-up closes
      cur = null;
    }
  }
  var saved = null;

  function restoreFocus() {
    dirty = true;
    var vw = innerWidth, vh = innerHeight;
    var root = scopeRoot();
    if (saved && saved.isConnected && (root === document || root.contains(saved)) &&
        usable(saved, saved.getBoundingClientRect(), vw, vh)) {
      setFocus(saved, null);
    } else {
      var f = firstInView();
      if (f) setFocus(f, null);
    }
    saved = null;
  }

  function move(dir, retried) {
    var vw = innerWidth, vh = innerHeight;
    validateCur();
    if (!cur) {
      var f = firstInView();
      if (f) setFocus(f, dir);
      return;
    }
    var a = cur.getBoundingClientRect();
    var acx = a.left + a.width / 2, acy = a.top + a.height / 2;
    var horiz = dir === 'right' || dir === 'left';
    var best = null, bs = Infinity;      // same row / column
    var far = null, fs = Infinity;       // fallback: another row (e.g. side menu)
    var list = collect();
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e === cur || e.contains(cur) || cur.contains(e)) continue;
      var b = e.getBoundingClientRect();
      if (!usable(e, b, vw, vh)) continue;
      var bcx = b.left + b.width / 2, bcy = b.top + b.height / 2;
      var main, gap, off, s;
      if (horiz) {
        if (dir === 'right' && bcx <= acx + 2) continue;
        if (dir === 'left' && bcx >= acx - 2) continue;
        main = dir === 'right' ? Math.max(0, b.left - a.right) : Math.max(0, a.left - b.right);
        gap = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
        off = Math.abs(bcy - acy);
        s = main + off * 0.4;
        if (gap === 0) {
          if (s < bs) { bs = s; best = e; }
        } else if (visibleX(e, b, vw)) {
          s += gap * 2;
          if (s < fs) { fs = s; far = e; }
        }
        continue;
      }
      if (dir === 'down' && bcy <= acy + 2) continue;
      if (dir === 'up' && bcy >= acy - 2) continue;
      if (!visibleX(e, b, vw)) continue;  // hidden carousel items
      // must really be below/above, not just overlapping a little
      if (dir === 'down' && b.top < a.top + a.height * 0.5) continue;
      if (dir === 'up' && b.bottom > a.bottom - a.height * 0.5) continue;
      main = dir === 'down' ? Math.max(0, b.top - a.bottom) : Math.max(0, a.top - b.bottom);
      var colX = stickyX != null ? stickyX : acx;
      gap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      // distance to the remembered column (where Left/Right last left us)
      off = (colX >= b.left && colX <= b.right) ? 0 : Math.min(Math.abs(colX - b.left), Math.abs(colX - b.right));
      // strongly prefer the very next row: rows further away cost much more
      s = main * 3 + off * 1 + gap * 0.2;
      if (gap === 0 || off === 0) {                 // same column: first choice
        if (s < bs) { bs = s; best = e; }
      } else if (s < fs) { fs = s; far = e; }       // e.g. the side menu: only if nothing else
    }
    if (!best && horiz && !retried) {
      var arrow = rowArrow(rowOf(cur), dir);
      if (arrow) {                         // more titles in this row: page it
        arrow.click();
        dirty = true;
        setTimeout(function () { move(dir, true); }, 420);
        return;
      }
    }
    best = best || far;
    if (best) { setFocus(best, dir); return; }

    // Nothing that way: scroll to load more rows, then try again once.
    if (!retried && (dir === 'down' || dir === 'up')) {
      window.scrollBy({ top: (dir === 'down' ? 1 : -1) * vh * 0.6, behavior: 'smooth' });
      dirty = true;
      setTimeout(function () { move(dir, true); }, 450);
    }
  }

  /* ------------------------------------------------ 5. clicking */

  function activate(e) {
    if (isText(e)) { e.focus(); try { e.click(); } catch (x) {} return; }
    var r = e.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, view: window, button: 0,
              clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    try {
      var po = Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, o);
      e.dispatchEvent(new PointerEvent('pointerdown', po));
      e.dispatchEvent(new MouseEvent('mousedown', o));
      e.dispatchEvent(new PointerEvent('pointerup', po));
      e.dispatchEvent(new MouseEvent('mouseup', o));
    } catch (x) {}
    e.dispatchEvent(new MouseEvent('click', o));
    dirty = true;
    setTimeout(function () { burst(600); }, 50);
    // If the click opened a pop-up/panel, move the focus into it
    // (checked twice: pop-ups animate in).
    [550, 1300, 2200].forEach(function (ms) {
      setTimeout(function () {
        dirty = true;
        validateCur();
        if ((!cur || autoFocused) && !mainVideo()) {
          var f = firstInView();
          if (f && f !== cur) autoFocus(f);
        }
        place();
      }, ms);
    });
  }

  /* ------------------------------------------------ 6. video player */

  var controls = false;   // navigating the player's own buttons
  var controlsTimer = 0;

  function mainVideo() {
    var vids = document.querySelectorAll('video'), best = null, area = 0;
    for (var i = 0; i < vids.length; i++) {
      var r = vids[i].getBoundingClientRect(), a = r.width * r.height;
      if (a > area) { area = a; best = vids[i]; }
    }
    if (!best || best.readyState === 0) return null;
    // Only the real player counts – not trailers that auto-play on the home page.
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    var watchPage = /\/watch(\/|$|\?)/.test(location.pathname) || (fs && fs.contains(best));
    if (watchPage && area >= innerWidth * innerHeight * 0.5) return best;
    if (!best.muted && area >= innerWidth * innerHeight * 0.9) return best;
    return null;
  }

  function wakeControls(v) {
    var r = v.getBoundingClientRect();
    var o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.6 };
    try {
      v.dispatchEvent(new MouseEvent('mousemove', o));
      (v.parentElement || v).dispatchEvent(new MouseEvent('mousemove', o));
    } catch (x) {}
  }

  function fmt(t) {
    if (!isFinite(t)) return '';
    t = Math.max(0, Math.floor(t));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---- bottom player bar: time, progress, remaining / LIVE ---- */

  var bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:2147483646;pointer-events:none;display:none;' +
    'padding:60px 5% 26px;background:linear-gradient(transparent,rgba(0,0,0,.85));' +
    'font:600 18px/1.2 system-ui,sans-serif;color:#fff;';
  bar.innerHTML =
    '<div data-r="top" style="display:flex;align-items:center;gap:14px;margin-bottom:10px">' +
      '<span data-r="icon" style="font-size:22px;width:26px;text-align:center"></span>' +
      '<span data-r="live" style="display:none;background:#e50914;border-radius:4px;padding:2px 8px;font-size:14px;letter-spacing:.5px">LIVE</span>' +
      '<span data-r="target" style="font-size:20px"></span>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:16px">' +
      '<span data-r="left" style="min-width:76px;font-variant-numeric:tabular-nums"></span>' +
      '<div data-r="track" style="position:relative;flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.25)">' +
        '<div data-r="buf" style="position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:rgba(255,255,255,.35)"></div>' +
        '<div data-r="played" style="position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:#2d8cff"></div>' +
        '<div data-r="ghost" style="position:absolute;top:-5px;width:4px;height:16px;margin-left:-2px;border-radius:2px;background:#fff;display:none"></div>' +
        '<div data-r="knob" style="position:absolute;top:-5px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:#fff;box-shadow:0 0 6px rgba(0,0,0,.6)"></div>' +
      '</div>' +
      '<span data-r="right" style="min-width:110px;text-align:right;font-variant-numeric:tabular-nums"></span>' +
    '</div>';
  function part(n) { return bar.querySelector('[data-r="' + n + '"]'); }
  var barTimer = 0, barTick = 0;

  function range(v) {
    var live = !isFinite(v.duration) || v.duration > 6 * 3600;
    var lo = 0, hi = isFinite(v.duration) ? v.duration : 0;
    try {
      if (v.seekable && v.seekable.length) {
        var s0 = v.seekable.start(0), s1 = v.seekable.end(v.seekable.length - 1);
        if (live) { lo = s0; hi = s1; }
        else if (!hi) { lo = s0; hi = s1; }
      }
    } catch (x) {}
    return { live: live, lo: lo, hi: hi };
  }

  function renderBar(v) {
    var g = range(v), span = Math.max(1, g.hi - g.lo);
    var now = v.currentTime, target = pendingSeek != null ? pendingSeek : null;
    var pos = target != null ? target : now;
    var pct = function (t) { return Math.max(0, Math.min(100, (t - g.lo) / span * 100)) + '%'; };
    var bufEnd = now;
    try {
      for (var i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= now + 0.5 && v.buffered.end(i) >= now) bufEnd = v.buffered.end(i);
      }
    } catch (x) {}
    part('played').style.width = pct(now);
    part('buf').style.width = pct(bufEnd);
    part('knob').style.left = pct(pos);
    part('ghost').style.left = pct(now);
    part('ghost').style.display = target != null ? 'block' : 'none';
    part('icon').textContent = v.paused ? '❚❚' : '▶';

    var behind = g.hi - pos;
    if (g.live) {
      var atLive = behind < 20;
      part('live').style.display = 'inline-block';
      part('live').style.background = atLive ? '#e50914' : 'rgba(255,255,255,.3)';
      part('left').textContent = atLive ? 'Live' : fmt(pos - g.lo);
      part('right').textContent = atLive ? 'LIVE' : '−' + fmt(behind) + ' to live';
    } else {
      part('live').style.display = 'none';
      part('left').textContent = fmt(pos);
      part('right').textContent = '−' + fmt(Math.max(0, g.hi - pos)) + '  /  ' + fmt(g.hi);
    }
    if (target != null) {
      var d = Math.round(target - now);
      part('target').textContent = (d >= 0 ? '⏩ +' : '⏪ −') + fmt(Math.abs(d)) + '   →  ' +
        (g.live ? (behind < 20 ? 'LIVE' : '−' + fmt(behind) + ' to live') : fmt(target));
    } else {
      part('target').textContent = v.paused ? 'Paused' : '';
    }
  }

  function showBar(v, sticky) {
    var p = overlayParent();
    if (p && bar.parentNode !== p) p.appendChild(bar);
    renderBar(v);
    bar.style.display = 'block';
    osd.style.display = 'none';
    clearTimeout(barTimer);
    clearInterval(barTick);
    barTick = setInterval(function () {
      if (bar.style.display === 'none' || !v.isConnected) { clearInterval(barTick); return; }
      renderBar(v);
    }, 400);
    if (!sticky && !v.paused) barTimer = setTimeout(hideBar, 3500);
  }
  function hideBar() {
    if (pendingSeek != null) return;
    var v = mainVideo();
    if (v && v.paused) return;                       // stays up while paused
    bar.style.display = 'none';
    clearInterval(barTick);
  }

  /* ---- seeking with a preview: the target moves while you press,
         the video jumps once you stop ---- */
  var pendingSeek = null, seekTimer = 0, holdStart = 0;

  function clampTime(v, t) {
    var g = range(v);
    return Math.min(Math.max(t, g.lo), Math.max(g.lo, g.hi - 0.5));
  }

  function seek(v, delta) {
    var base = pendingSeek != null ? pendingSeek : v.currentTime;
    pendingSeek = clampTime(v, base + delta);
    showBar(v, true);
    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () { commitSeek(v); }, 700);
  }

  function commitSeek(v) {
    clearTimeout(seekTimer);
    if (pendingSeek == null) return;
    var t = pendingSeek;
    pendingSeek = null;
    try { v.currentTime = t; } catch (x) {}
    showBar(v, false);
  }

  function seekStep(ev) {
    if (!ev || !ev.repeat) { holdStart = performance.now(); return 10; }
    var held = (performance.now() - holdStart) / 1000;
    return held > 6 ? 300 : held > 3 ? 120 : held > 1.2 ? 60 : 30;   // speeds up while held
  }

  function togglePlay(v) {
    if (pendingSeek != null) { commitSeek(v); return; }   // OK confirms a seek
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
    else v.pause();
    setTimeout(function () { showBar(v, false); }, 30);
  }

  // Show the bar briefly when a video starts, and keep it while paused.
  document.addEventListener('pause', function (ev) {
    var v = ev.target;
    if (v && v.tagName === 'VIDEO' && v === mainVideo()) showBar(v, true);
  }, true);
  document.addEventListener('playing', function (ev) {
    var v = ev.target;
    if (v && v.tagName === 'VIDEO' && v === mainVideo() && bar.style.display === 'block') showBar(v, false);
  }, true);

  function enterControls(v, dir) {
    controls = true;
    wakeControls(v);
    setTimeout(function () {
      dirty = true;
      var vw = innerWidth, vh = innerHeight, best = null, bs = Infinity;
      collect().forEach(function (e) {
        var r = e.getBoundingClientRect();
        if (!usable(e, r, vw, vh)) return;
        if (r.top < 0 || r.bottom > vh || r.left < 0 || r.right > vw) return;
        var cy = r.top + r.height / 2, cx = r.left + r.width / 2;
        var s = (dir === 'up' ? cy : vh - cy) * 2 + Math.abs(cx - vw / 2) * 0.5;
        if (s < bs) { bs = s; best = e; }
      });
      if (best) setFocus(best, null);
      showOsd('Player buttons  ·  BACK to return');
    }, 350);
    armControlsTimeout();
  }

  function armControlsTimeout() {
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(function () { leaveControls(); }, 8000);
  }

  function leaveControls() {
    controls = false;
    clearTimeout(controlsTimer);
    if (mainVideo()) { ringHidden = true; place(); }
  }

  function playerKey(k, ev, v) {
    if (k === 'ok') togglePlay(v);
    else if (k === 'left') seek(v, -seekStep(ev));
    else if (k === 'right') seek(v, seekStep(ev));
    else {
      if (pendingSeek != null) commitSeek(v);
      bar.style.display = 'none';
      enterControls(v, k);
    }
  }

  // keep the TV awake only while something is playing
  function reportPlaying() {
    if (!native) return;
    var v = document.querySelector('video');
    try { native.setPlaying(!!(v && !v.paused && !v.ended)); } catch (x) {}
  }
  ['playing', 'pause', 'ended', 'emptied'].forEach(function (t) {
    document.addEventListener(t, function () {
      reportPlaying();
      if (t === 'playing' && !controls && mainVideo()) { ringHidden = true; place(); }
    }, true);
  });

  /* ------------------------------------------------ 7. keys */

  function keyName(ev) {
    switch (ev.key) {
      case 'ArrowLeft': return 'left';
      case 'ArrowRight': return 'right';
      case 'ArrowUp': return 'up';
      case 'ArrowDown': return 'down';
      case 'Enter': return 'ok';
    }
    switch (ev.keyCode) {
      case 37: return 'left';
      case 39: return 'right';
      case 38: return 'up';
      case 40: return 'down';
      case 13: case 23: return 'ok';
    }
    return null;
  }

  function stop(ev) { ev.preventDefault(); ev.stopImmediatePropagation(); }

  var okDownAt = 0, okLong = false;
  window.addEventListener('keydown', function (ev) {
    if (!ev.isTrusted) return;
    var k = keyName(ev);
    if (!k) return;
    var ae = document.activeElement;

    // Typing in a search box: let left/right move the cursor and OK submit.
    if (isText(ae) && (k === 'left' || k === 'right' || k === 'ok')) return;

    // OK acts when released; holding it opens the Stream TV menu.
    if (k === 'ok') {
      stop(ev);
      if (!ev.repeat) { okDownAt = performance.now(); okLong = false; return; }
      if (!okLong && okDownAt && performance.now() - okDownAt > 650) {
        okLong = true;
        openMenu();
      }
      return;
    }
    handleKey(k, ev, ae);
  }, true);

  function okReleased(ev) {
    var wasLong = okLong;
    okDownAt = 0; okLong = false;
    if (wasLong) return;
    handleKey('ok', ev, document.activeElement);
  }

  function handleKey(k, ev, ae) {

    var v = mainVideo();
    if (v && !controls && !menu) { stop(ev); playerKey(k, ev, v); return; }
    stop(ev);
    if (controls && v && !menu) {
      // keep the player's buttons on screen while we move between them
      armControlsTimeout();
      wakeControls(v);
      setTimeout(function () { navKey(k, ae); }, 90);
      return;
    }
    navKey(k, ae);
  }

  function navKey(k, ae) {
    if (k === 'ok') {
      validateCur();
      if (cur) {
        ringHidden = false;
        activate(cur);
      } else move('down');
      return;
    }
    if (isText(ae)) ae.blur();
    if (ringHidden) { ringHidden = false; place(); if (cur && cur.isConnected) return; }
    move(k);
  }

  // swallow the matching keyup so the site's own shortcuts don't fire twice
  window.addEventListener('keyup', function (ev) {
    var k = keyName(ev);
    if (!k) return;
    if (isText(document.activeElement) && (k === 'left' || k === 'right' || k === 'ok')) return;
    stop(ev);
    if (k === 'ok' && ev.isTrusted && okDownAt) okReleased(ev);
  }, true);

  /* ------------------------------------------------ 8. Stream TV menu */

  var menu = null;
  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    saved = menuReturn;
    restoreFocus();
  }
  var menuReturn = null;
  var FALLBACK_LANGS = [
    ['Hindi', 'hin', 'hi'], ['Tamil', 'tam', 'ta'], ['Telugu', 'tel', 'te'], ['Malayalam', 'mal', 'ml'],
    ['Kannada', 'kan', 'kn'], ['Bengali', 'ben', 'bn'], ['Marathi', 'mar', 'mr'], ['English', 'eng', 'en']
  ].map(function (l) { return { name: l[0], iso3code: l[1], iso2code: l[2], note: '' }; });

  function currentLang() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q) return q.toLowerCase();
    var list = langInfo.list || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].raw && (list[i].raw.is_selected || list[i].raw.is_default)) return (list[i].iso3code || '').toLowerCase();
    }
    return '';
  }

  function menuButton(text, selected, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = (selected ? '✓  ' : '     ') + text;
    b.style.cssText = 'display:block;width:100%;text-align:left;margin:5px 0;padding:10px 14px;' +
      'border:0;border-radius:10px;font:inherit;color:#fff;cursor:pointer;white-space:nowrap;' +
      'background:' + (selected ? '#2d4bff' : '#262a35');
    b.addEventListener('click', onClick);
    return b;
  }

  function menuColumn(title, subtitle) {
    var col = document.createElement('div');
    col.style.cssText = 'min-width:250px;max-height:78vh;overflow-y:auto;padding:0 6px';
    var h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-weight:700;font-size:20px;margin-bottom:2px';
    var sub = document.createElement('div');
    sub.textContent = subtitle;
    sub.style.cssText = 'opacity:.6;font-size:13px;margin-bottom:8px';
    col.appendChild(h); col.appendChild(sub);
    return col;
  }

  function openMenu() {
    if (menu) { closeMenu(); return; }
    menuReturn = cur;
    menu = document.createElement('div');
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-modal', 'true');
    menu.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.6);display:flex;' +
      'align-items:center;justify-content:center;font:500 16px/1.3 system-ui,sans-serif;color:#fff';
    var box = document.createElement('div');
    box.style.cssText = 'background:#16181f;border-radius:16px;padding:20px 22px;' +
      'box-shadow:0 10px 40px rgba(0,0,0,.6);max-width:94vw';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:26px;align-items:flex-start';
    var first = null;

    // Video quality
    var v = document.querySelector('video');
    var qcol = menuColumn('Video quality',
      v && v.videoHeight ? 'Now playing: ' + (v.videoHeight >= 2000 ? '4K' : v.videoHeight + 'p') : 'Used for all videos');
    var current = getQuality();
    QUALITIES.forEach(function (q) {
      var b = menuButton(q.label, q.id === current.id, function () { chooseQuality(q); });
      qcol.appendChild(b);
      if (q.id === current.id) first = b;
    });
    row.appendChild(qcol);

    // Audio language (watch pages)
    if (/\/watch(\/|$)/.test(location.pathname)) {
      var known = langInfo.list && langInfo.path === location.pathname ? langInfo.list : null;
      var langs = known || FALLBACK_LANGS;
      var lcol = menuColumn('Audio language', known ? 'Languages of this title' : 'If available for this title');
      var curLang = currentLang();
      langs.forEach(function (l) {
        var sel = curLang && (curLang === (l.iso3code || '').toLowerCase() || curLang === (l.iso2code || '').toLowerCase());
        var label = l.name + (l.note && /original/i.test(l.note) ? '  (original)' : '');
        var b = menuButton(label, sel, function () { chooseLanguage(l); });
        lcol.appendChild(b);
        if (sel && !first) first = b;
      });
      row.appendChild(lcol);
    }

    box.appendChild(row);
    var note = document.createElement('div');
    note.textContent = 'Hold OK any time to open this menu  ·  BACK to close';
    note.style.cssText = 'opacity:.5;font-size:13px;margin-top:10px';
    box.appendChild(note);
    menu.appendChild(box);
    menu.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    document.body.appendChild(menu);
    dirty = true;
    setTimeout(function () { if (first) setFocus(first, null); }, 30);
  }

  function saveResume() {
    var v = mainVideo();
    if (!v) return;
    try {
      sessionStorage.setItem('streamtv.resume', JSON.stringify(
        { path: location.pathname, t: v.currentTime, at: Date.now() }));
    } catch (e) {}
  }

  function chooseLanguage(l) {
    menu && menu.remove(); menu = null;
    // Save it the way JioHotstar does, so it sticks for this title …
    try {
      var key = null;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('__VIDEO_PREFERENCE_AUDIO_') === 0) { key = k; break; }
      }
      if (key && langInfo.prefId) {
        var store = JSON.parse(localStorage.getItem(key) || '{}');
        var arr = Array.isArray(store.value) ? store.value : [];
        arr = arr.filter(function (e) { return e && e.id !== langInfo.prefId; });
        var val = Object.assign({}, l.raw || { iso2code: l.iso2code, iso3code: l.iso3code, name: l.name },
          { is_selected: true });
        arr.push({ id: langInfo.prefId, value: val, isManual: true, isLive: false });
        store.value = arr;
        localStorage.setItem(key, JSON.stringify(store));
      }
    } catch (e) {}
    // … and reopen the video in that language at the same point.
    saveResume();
    showOsd('Switching audio to ' + l.name + '…');
    var u = new URL(location.href);
    u.searchParams.set('lang', l.iso3code || l.iso2code);
    setTimeout(function () { location.replace(u.toString()); }, 400);
  }

  function chooseQuality(q) {
    try { localStorage.setItem('streamtv.quality', q.id); } catch (e) {}
    var v = document.querySelector('video');
    menu && menu.remove(); menu = null;
    if (v && mainVideo()) {
      // restart the player with the new quality, at the same point
      saveResume();
      showOsd('Switching to ' + q.label.split('  ')[0] + '…');
      setTimeout(function () { location.reload(); }, 400);
    } else {
      showOsd('Quality: ' + q.label.split('  ')[0]);
      location.reload();
    }
  }

  // Back at the same point after a quality switch
  (function resumeAfterSwitch() {
    var r = null;
    try { r = JSON.parse(sessionStorage.getItem('streamtv.resume') || 'null'); } catch (e) {}
    if (!r || r.path !== location.pathname || Date.now() - r.at > 120000) return;
    var done = false;
    function tryResume() {
      var v = mainVideo();
      if (done || !v || !(v.duration > 0)) return;
      done = true;
      try { sessionStorage.removeItem('streamtv.resume'); } catch (e) {}
      if (Math.abs(v.currentTime - r.t) > 5) v.currentTime = r.t;
    }
    ['loadedmetadata', 'playing', 'canplay'].forEach(function (t) {
      document.addEventListener(t, function () { setTimeout(tryResume, 300); }, true);
    });
  })();

  // Show the real resolution when a video starts or the quality changes
  var shownH = 0, firstHint = true;
  document.addEventListener('resize', function (ev) {
    var v = ev.target;
    if (!v || v.tagName !== 'VIDEO' || !v.videoHeight || v !== mainVideo()) return;
    if (v.videoHeight === shownH) return;
    shownH = v.videoHeight;
    var p = v.videoHeight >= 2000 ? '4K' : v.videoHeight + 'p';
    showOsd('Playing in ' + p + (firstHint ? '  ·  hold OK for quality' : ''));
    firstHint = false;
  }, true);

  /* ------------------------------------------------ 9. jump to last episode */

  var EP_RE = /\bS\d+\s*E\d+\b|\bEpisode\s+\d+\b|\bEp\.?\s*\d+\b/i;
  var MORE_RE = /^(view|load|show|see)\s+(more|all)|more episodes/i;

  function textOf(e) { return (e.textContent || '').replace(/\s+/g, ' ').trim(); }

  function findEpisodesTab(root) {
    var els = root.querySelectorAll('button,[role=tab],a,div,span,p');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.children.length > 2) continue;
      if (textOf(e) !== 'Episodes') continue;
      var r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return e.closest('button,[role=tab],a') || e;
    }
    return null;
  }

  function episodeCards(root) {
    var out = [];
    collect().forEach(function (e) {
      if (root !== document && !root.contains(e)) return;
      if (EP_RE.test(textOf(e)) && !MORE_RE.test(textOf(e))) out.push(e);
    });
    return out;
  }

  function moreButton(root) {
    var bs = root.querySelectorAll('button,[role=button],a,div,span');
    for (var i = bs.length - 1; i >= 0; i--) {
      var b = bs[i], t = textOf(b);
      if (t.length > 30 || !MORE_RE.test(t)) continue;
      if (/view all/i.test(t) && !b.closest('[data-testid*="episode" i],[class*="episode" i]')) continue;
      var r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return b.closest('button,[role=button],a') || b;
    }
    return null;
  }

  function seasonChips(root) {
    var out = [];
    root.querySelectorAll('button,[role=tab],[role=option],li,a,div,span').forEach(function (e) {
      if (e.children.length > 2) return;
      if (/^Season\s+\d+$/i.test(textOf(e))) out.push(e.closest('button,[role=tab],[role=option],li,a') || e);
    });
    return out;
  }

  var lastEpBusy = false;
  function goToLastEpisode() {
    if (lastEpBusy) return;
    lastEpBusy = true;
    var root = scopeRoot();
    var chips = seasonChips(root);
    var startDelay = 0;
    if (chips.length > 1) {                       // open the latest season first
      var nums = chips.map(function (c) { return parseInt(textOf(c).replace(/\D+/g, ''), 10) || 0; });
      var last = chips[nums.indexOf(Math.max.apply(null, nums))];
      activate(last);
      startDelay = 1500;
    }
    var rounds = 0, lastCount = -1, stuck = 0;
    function step() {
      dirty = true;
      var cards = episodeCards(root);
      var more = moreButton(root);
      showOsd('Loading episodes…  ' + cards.length);
      if (more && rounds < 400 && stuck < 6) {
        if (cards.length === lastCount) stuck++; else stuck = 0;
        lastCount = cards.length;
        rounds++;
        more.click();
        setTimeout(step, 700);
        return;
      }
      lastEpBusy = false;
      if (!cards.length) { showOsd('No episode list on this page'); return; }
      var lastCard = cards[cards.length - 1];
      setFocus(lastCard, 'down');
      showOsd('Last episode  ·  ' + cards.length + ' loaded');
    }
    setTimeout(step, startDelay);
  }

  // Put a "Last episode" button next to the Episodes tab of a series.
  var lastEpBtn = null;
  function ensureLastEpButton() {
    if (!/\/(shows|tv)\/[^/]+\/\d+/.test(location.pathname) || mainVideo()) {
      if (lastEpBtn) { lastEpBtn.remove(); lastEpBtn = null; }
      return;
    }
    var root = scopeRoot();
    var tab = findEpisodesTab(root === document ? document : root);
    if (!tab) { if (lastEpBtn) { lastEpBtn.remove(); lastEpBtn = null; } return; }
    if (lastEpBtn && lastEpBtn.isConnected && tab.parentElement &&
        tab.parentElement.contains(lastEpBtn)) return;
    if (lastEpBtn) lastEpBtn.remove();
    lastEpBtn = document.createElement('button');
    lastEpBtn.type = 'button';
    lastEpBtn.textContent = '⏭  Last episode';
    lastEpBtn.setAttribute('aria-label', 'Go to last episode');
    lastEpBtn.style.cssText = 'margin-left:18px;padding:6px 14px;border-radius:18px;border:0;' +
      'background:rgba(255,255,255,.14);color:#fff;font:600 14px/1.2 system-ui,sans-serif;' +
      'cursor:pointer;white-space:nowrap;align-self:center;flex:0 0 auto';
    lastEpBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      goToLastEpisode();
    }, true);
    tab.insertAdjacentElement('afterend', lastEpBtn);
    dirty = true;
  }
  setInterval(ensureLastEpButton, 1200);

  /* ------------------------------------------------ 10. calls from the app */

  // BACK: returns true if handled here, false to let the app go back a page.
  tv.back = function () {
    if (pendingSeek != null) {
      clearTimeout(seekTimer); pendingSeek = null;
      var pv = mainVideo(); if (pv) showBar(pv, false);
      return true;
    }
    if (controls) { leaveControls(); return true; }
    var ae = document.activeElement;
    if (isText(ae)) { ae.blur(); return true; }
    if (mainVideo()) return false;              // leave the player
    var root = scopeRoot();
    if (root === document) return false;        // normal page: go back
    // A pop-up / panel is open: ask the site to close it.
    var o = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', o));
    document.dispatchEvent(new KeyboardEvent('keyup', o));
    setTimeout(function () {
      if (scopeRoot() !== root) { restoreFocus(); return; }
      var c = root.querySelector('[aria-label*="close" i],[aria-label*="dismiss" i],[aria-label*="back" i],' +
        '[class*="close" i],[data-testid*="close" i],[data-testid*="back" i]');
      if (c) activate(c);
      setTimeout(function () {
        if (scopeRoot() !== root) { restoreFocus(); return; }
        // Not a closable pop-up (e.g. a full-screen page): go back a page.
        if (native && native.goBack) native.goBack();
      }, 350);
    }, 200);
    cur = null;
    return true;
  };

  tv.media = function (cmd) {
    var v = mainVideo() || document.querySelector('video');
    if (!v) return;
    if (cmd === 'playpause') togglePlay(v);
    else if (cmd === 'play') { if (v.paused) togglePlay(v); }
    else if (cmd === 'pause') { if (!v.paused) v.pause(); }
    else if (cmd === 'ff') seek(v, 30);
    else if (cmd === 'rw') seek(v, -30);
  };

  // The site changed page (it is a single-page app): start fresh.
  tv.onRoute = function () {
    stickyX = null;
    pendingSeek = null;
    bar.style.display = 'none';
    controls = false;
    ringHidden = false;
    dirty = true;
    cur = null;
    place();
    var path = location.pathname;
    var remembered = {}; remembered[path] = lastByPath[path];
    [700, 1500, 2600].forEach(function (ms) {
      setTimeout(function () {
        dirty = true;
        validateCur();
        if ((cur && !autoFocused) || mainVideo() || location.pathname !== path) return;
        // back on a page we visited: return to the title we were on
        var prev = remembered[path], root = scopeRoot();
        if (prev && prev.isConnected && (root === document || root.contains(prev)) &&
            usable(prev, prev.getBoundingClientRect(), innerWidth, innerHeight)) {
          if (prev !== cur) autoFocus(prev);
          return;
        }
        var f = firstInView();
        if (f && f !== cur) autoFocus(f);
      }, ms);
    });
  };

  // Notice page changes ourselves too (the site is a single-page app).
  try {
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      history[m] = function () {
        var before = location.pathname;
        var r = orig.apply(this, arguments);
        if (location.pathname !== before) setTimeout(tv.onRoute, 50);
        return r;
      };
    });
    window.addEventListener('popstate', function () { setTimeout(tv.onRoute, 50); });
  } catch (e) {}

  // first focus once the home page has drawn
  function initialFocus(tries) {
    if (cur || mainVideo()) return;
    var f = document.body && firstInView();
    if (f) setFocus(f, null);
    else if (tries < 20) setTimeout(function () { initialFocus(tries + 1); }, 500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initialFocus(0); });
  } else {
    initialFocus(0);
  }
})();
