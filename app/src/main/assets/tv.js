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

  // Adaptive players start at the bitrate they think the line can carry.
  // Report a fast, unmetered connection so they start (and stay) at the top.
  try {
    var conn = {
      downlink: 100, downlinkMax: Infinity, effectiveType: '4g', rtt: 20,
      saveData: false, type: 'ethernet', onchange: null,
      addEventListener: function () {}, removeEventListener: function () {},
      dispatchEvent: function () { return true; }
    };
    Object.defineProperty(Navigator.prototype, 'connection', {
      get: function () { return conn; }, configurable: true
    });
  } catch (e) {}

  // Report the TV's real pixel size (1920x1080 or more) so the player
  // does not cap the resolution to the small CSS viewport.
  try {
    var dpr = window.devicePixelRatio || 1;
    var W = Math.max(1920, Math.round(screen.width * dpr));
    var H = Math.max(1080, Math.round(screen.height * dpr));
    ['width', 'availWidth'].forEach(function (k) {
      Object.defineProperty(Screen.prototype, k, { get: function () { return W; }, configurable: true });
    });
    ['height', 'availHeight'].forEach(function (k) {
      Object.defineProperty(Screen.prototype, k, { get: function () { return H; }, configurable: true });
    });
  } catch (e) {}

  var HIGH_BW = 80e6; // 80 Mbit/s starting estimate

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

  function scopeRoot() {
    var dlg = document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open]');
    for (var i = dlg.length - 1; i >= 0; i--) {
      var r = dlg[i].getBoundingClientRect();
      if (r.width > 40 && r.height > 40 && getComputedStyle(dlg[i]).visibility !== 'hidden') return dlg[i];
    }
    var fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs && fs.tagName !== 'VIDEO') return fs;
    return document;
  }

  function collect() {
    var root = scopeRoot();
    var now = performance.now();
    if (cache && !dirty && cache.root === root && now - cacheAt < 1500) return cache.list;
    var set = new Set();
    root.querySelectorAll(SEL).forEach(function (e) {
      if (!e.disabled && e.getAttribute('aria-disabled') !== 'true' && e !== ring) set.add(e);
    });
    // React-style clickable <div>s: outermost element that shows a hand cursor
    var all = root.querySelectorAll(POINTER_SEL);
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (set.has(e)) continue;
      var cs = getComputedStyle(e);
      if (cs.cursor !== 'pointer') continue;
      var p = e.parentElement;
      if (p && getComputedStyle(p).cursor === 'pointer') continue;
      set.add(e);
    }
    var list = Array.from(set);
    cache = { root: root, list: list };
    cacheAt = now;
    dirty = false;
    return list;
  }

  function usable(e, r, vw, vh) {
    if (!e.isConnected) return false;
    if (r.width < 8 || r.height < 8) return false;
    if (r.width * r.height > vw * vh * 0.6) return false; // page wrappers
    if (r.bottom < -vh * 3 || r.top > vh * 4) return false;
    var cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) return false;
    return true;
  }

  /* ------------------------------------------------ 4. moving the focus */

  function setFocus(e, dir) {
    cur = e;
    ringHidden = false;
    try { if (e.tabIndex >= 0 || isText(e)) e.focus({ preventScroll: true }); } catch (x) {}
    try {
      var vertical = dir === 'up' || dir === 'down';
      e.scrollIntoView({ block: vertical ? 'center' : 'nearest', inline: 'nearest', behavior: 'smooth' });
    } catch (x) { try { e.scrollIntoView(false); } catch (y) {} }
    burst(700);
  }

  function firstInView() {
    var vw = innerWidth, vh = innerHeight, best = null, bs = Infinity;
    collect().forEach(function (e) {
      var r = e.getBoundingClientRect();
      if (!usable(e, r, vw, vh)) return;
      if (r.top < 0 || r.left < 0 || r.top > vh || r.left > vw) return;
      var s = r.top * 2 + r.left;
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

  function move(dir, retried) {
    var vw = innerWidth, vh = innerHeight;
    if (!cur || !cur.isConnected) {
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
      if (e === cur || e.contains(cur)) continue;
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
      main = dir === 'down' ? Math.max(0, b.top - a.bottom) : Math.max(0, a.top - b.bottom);
      gap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      off = Math.abs(bcx - acx);
      s = main * 1.2 + gap * 1.5 + off * 0.3;
      if (s < bs) { bs = s; best = e; }
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
    if (best && area >= innerWidth * innerHeight * 0.5 && best.readyState > 0) return best;
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

  function seek(v, delta) {
    var target = v.currentTime + delta;
    try {
      if (v.seekable && v.seekable.length) {
        var lo = v.seekable.start(0), hi = v.seekable.end(v.seekable.length - 1);
        target = Math.min(Math.max(target, lo), hi - 0.5);
      } else if (isFinite(v.duration)) {
        target = Math.min(Math.max(target, 0), v.duration - 0.5);
      }
    } catch (x) {}
    v.currentTime = target;
    var dur = isFinite(v.duration) ? ' / ' + fmt(v.duration) : '';
    showOsd((delta > 0 ? '⏩ +' : '⏪ ') + delta + 's   ' + fmt(target) + dur);
    wakeControls(v);
  }

  function togglePlay(v) {
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); showOsd('▶  Play'); }
    else { v.pause(); showOsd('❚❚  Pause'); }
    wakeControls(v);
  }

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
    }, 120);
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
    else if (k === 'left') seek(v, ev.repeat ? -30 : -10);
    else if (k === 'right') seek(v, ev.repeat ? 30 : 10);
    else enterControls(v, k);
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
      if (t === 'playing' && !controls) { ringHidden = true; place(); }
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

  window.addEventListener('keydown', function (ev) {
    if (!ev.isTrusted) return;
    var k = keyName(ev);
    if (!k) return;
    var ae = document.activeElement;

    // Typing in a search box: let left/right move the cursor and OK submit.
    if (isText(ae) && (k === 'left' || k === 'right' || k === 'ok')) return;

    var v = mainVideo();
    if (v && !controls) { stop(ev); playerKey(k, ev, v); return; }
    if (controls) armControlsTimeout();

    stop(ev);
    if (k === 'ok') {
      if (cur && cur.isConnected) {
        ringHidden = false;
        activate(cur);
      } else move('down');
      return;
    }
    if (isText(ae)) ae.blur();
    if (ringHidden) { ringHidden = false; place(); if (cur && cur.isConnected) return; }
    move(k);
  }, true);

  // swallow the matching keyup so the site's own shortcuts don't fire twice
  window.addEventListener('keyup', function (ev) {
    var k = keyName(ev);
    if (!k) return;
    if (isText(document.activeElement) && (k === 'left' || k === 'right' || k === 'ok')) return;
    stop(ev);
  }, true);

  /* ------------------------------------------------ 8. calls from the app */

  // BACK: returns true if handled here, false to let the app go back a page.
  tv.back = function () {
    if (controls) { leaveControls(); return true; }
    var ae = document.activeElement;
    if (isText(ae)) { ae.blur(); return true; }
    var root = scopeRoot();
    if (root !== document && !(document.fullscreenElement && root === document.fullscreenElement)) {
      var o = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', o));
      document.dispatchEvent(new KeyboardEvent('keyup', o));
      // If the dialog is still open, click its close button.
      setTimeout(function () {
        if (scopeRoot() !== root) return;
        var c = root.querySelector('[aria-label*="close" i],[aria-label*="dismiss" i],[class*="close" i],[data-testid*="close" i]');
        if (c) activate(c);
      }, 150);
      cur = null;
      dirty = true;
      setTimeout(function () { var f = firstInView(); if (f) setFocus(f, null); }, 400);
      return true;
    }
    return false;
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
    controls = false;
    ringHidden = false;
    dirty = true;
    cur = null;
    place();
    setTimeout(function () {
      if (!cur && !mainVideo()) { var f = firstInView(); if (f) setFocus(f, null); }
    }, 900);
  };

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
