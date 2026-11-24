/* Page d'invitation LEMO : « Bienvenue, Florio t'invite sur LEMO. » -> Commencer -> prénom -> WhatsApp.
   Un seul élément signature : l'orbe (≈180 points, canvas 2D).
   - écran 1 : sphère qui tourne lentement ; chaque frappe allume un point et accélère la rotation (« l'orbe écoute »)
   - validation : l'orbe se contracte, puis se déplie de gauche à droite en onde de message vocal
   - puis WhatsApp s'ouvre aussitôt
   Configuration injectée par le serveur dans <script id="cfg" type="application/json">. */
(function () {
  'use strict';
  var CFG = JSON.parse(document.getElementById('cfg').textContent);
  var qs = new URLSearchParams(location.search);
  var DEMO = qs.get('demo') === '1'; // ?demo=1 : aperçu sans redirection
  var REDIRECT_DELAY = 1800; // ms : le temps de voir l'orbe se déplier en onde, puis WhatsApp
  // Le message prérempli « Hey LEMO, c'est <prénom> ! » est celui que LEMO reconnaît pour lancer l'accueil.
  var WA_TEXT = function (prenom) { return "Hey LEMO, c'est " + prenom + ' !' + (CFG.code ? ' (invitation ' + CFG.code + ')' : ''); };
  var waLink = function (prenom) { return CFG.waNumber ? 'https://wa.me/' + CFG.waNumber + '?text=' + encodeURIComponent(WA_TEXT(prenom)) : CFG.wa; };

  /* ---------- Orbe : sphère de points -> onde vocale ---------- */
  function Orb(canvas, count) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.N = count || 180;
    this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.C = 30; // colonnes de l'onde
    this.rows = Math.ceil(this.N / this.C);
    var GA = Math.PI * (3 - Math.sqrt(5));
    var palette = ['#6B7CFF', '#6B7CFF', '#E8856B', '#B8A9D9'];
    this.pts = [];
    for (var i = 0; i < this.N; i++) {
      var y = 1 - (i / (this.N - 1)) * 2, r = Math.sqrt(1 - y * y), phi = i * GA;
      var colored = Math.random() < 0.16; // ≈85 % de neutres, accents parcimonieux
      this.pts.push({
        x: Math.cos(phi) * r, y: y, z: Math.sin(phi) * r,
        s: 0.75 + Math.random() * 0.95,
        col: colored ? palette[(Math.random() * palette.length) | 0] : null,
        ph: Math.random() * Math.PI * 2, fq: 0.5 + Math.random() * 0.9,
        pulse: 0, pulseCol: '#6B7CFF',
      });
    }
    this.cols = [];
    for (var c = 0; c < this.C; c++) this.cols.push({ r: 0.35 + Math.random() * 0.65, f: 2 + Math.random() * 2.6, ph: Math.random() * Math.PI * 2 });
    this.rot = 0; this.t = 0; this.energy = 0;
    this.scale = 0.85; this.scaleTarget = 1; // petite entrée à l'ouverture
    this.morph = 0; this.morphTarget = 0;
    this.resize();
    var self = this;
    if ('ResizeObserver' in window) new ResizeObserver(function () { self.resize(); }).observe(canvas);
    else window.addEventListener('resize', function () { self.resize(); });
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }
  Orb.prototype.resize = function () {
    var r = this.c.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  };
  Orb.prototype.ping = function () { // une frappe = un point qui s'allume
    var p = this.pts[(Math.random() * this.N) | 0];
    p.pulse = 1; p.pulseCol = Math.random() < 0.6 ? '#6B7CFF' : '#E8856B';
    this.energy = Math.min(this.energy + 0.45, 2.4);
  };
  Orb.prototype.gather = function () { this.scaleTarget = 0.6; this.energy = 2.4; };
  Orb.prototype.toWave = function () { this.scaleTarget = 1; this.morphTarget = 1; };
  Orb.prototype.toSphere = function () { this.scaleTarget = 1; this.morphTarget = 0; };
  Orb.prototype.frame = function (now) {
    var dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now; this.t += dt;
    var k = function (rate) { return 1 - Math.exp(-rate * dt); };
    this.energy += (0 - this.energy) * k(1.4);
    this.scale += (this.scaleTarget - this.scale) * k(6);
    var step = dt * 0.75; // ≈1,3 s pour un dépli complet
    this.morph = this.morph < this.morphTarget ? Math.min(this.morphTarget, this.morph + step) : Math.max(this.morphTarget, this.morph - step);
    this.rot += dt * (0.2 + this.energy * 0.85) * (this.reduced ? 0.15 : 1);
    this.draw(dt);
    requestAnimationFrame(this.frame);
  };
  Orb.prototype.draw = function (dt) {
    var ctx = this.ctx, W = this.w, H = this.h, C = this.C, rows = this.rows;
    var cx = W / 2, cy = H / 2, R = W * 0.36 * this.scale;
    var cr = Math.cos(this.rot), sr = Math.sin(this.rot);
    var tilt = 0.42, ct = Math.cos(tilt), st = Math.sin(tilt);
    var gap = (W * 0.8) / (C - 1), rowGap = H * 0.078;
    var ease = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < this.N; i++) {
      var p = this.pts[i];
      // sphère
      var wob = 1 + 0.035 * Math.sin(this.t * p.fq + p.ph);
      var x = p.x * wob, y = p.y * wob, z = p.z * wob;
      var x1 = x * cr + z * sr, z1 = -x * sr + z * cr;
      var y1 = y * ct - z1 * st, z2 = y * st + z1 * ct;
      var persp = 3 / (3 - z2), depth = (z2 + 1) / 2;
      var sx = cx + x1 * R * persp, sy = cy + y1 * R * persp;
      // onde vocale : colonnes de points, amplitude qui voyage
      var col = i % C, row = Math.floor(i / C);
      var env = Math.pow(Math.sin(Math.PI * (col + 0.5) / C), 0.7);
      var sp = this.reduced ? 0.15 : 1, cs = this.cols[col];
      var amp = env * (0.14 + 0.86 * cs.r * (0.5 + 0.5 * Math.sin(this.t * cs.f * sp + cs.ph)));
      var wx = cx + (col - (C - 1) / 2) * gap;
      var wy = cy + (row - (rows - 1) / 2) * rowGap * amp;
      // dépli de gauche à droite
      var mi = ease(Math.min(1, Math.max(0, this.morph * 1.6 - (col / C) * 0.6)));
      var px = sx + (wx - sx) * mi, py = sy + (wy - sy) * mi;
      var size = p.s * (0.55 + 0.75 * depth) * persp * (1 - mi) + 1.35 * mi;
      var alpha = (p.col ? 0.3 + 0.65 * depth : 0.1 + 0.55 * depth) * (1 - mi) + (p.col ? 0.95 : 0.8) * mi;
      var color = p.col || '#1A1A1A';
      if (p.pulse > 0) {
        p.pulse = Math.max(0, p.pulse - dt * 1.1);
        size *= 1 + 2.2 * p.pulse; alpha = Math.max(alpha, 0.35 + 0.65 * p.pulse); color = p.pulseCol;
      }
      ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px, py, size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /* ---------- Parcours : Commencer -> prénom -> onde -> WhatsApp ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var orb = new Orb($('orb'));
  var s1 = $('s1'), s2 = $('s2'), s3 = $('s3'), form = $('form'), input = $('prenom'), fallback = $('fallback');
  var timers = [];
  var tracked = false;

  var clean = function (v) { return v.replace(/\s+/g, ' ').trim().replace(/[^\p{L}' -]/gu, '').slice(0, 24); };
  var capitalize = function (v) { return v.replace(/(^|[\s-])(\p{L})/gu, function (m, a, b) { return a + b.toLocaleUpperCase('fr-FR'); }); };

  // Passe d'un écran à l'autre en fondu.
  function show(from, to, after) {
    from.classList.add('is-out');
    setTimeout(function () {
      from.hidden = true;
      to.hidden = false; to.classList.add('is-pre'); to.classList.remove('is-out');
      void to.offsetWidth;
      to.classList.remove('is-pre');
      if (after) after();
    }, 320);
  }

  $('start').addEventListener('click', function () {
    orb.ping();
    show(s1, s2, function () { input.focus({ preventScroll: true }); });
  });

  input.addEventListener('input', function () {
    orb.ping();
    form.classList.remove('is-error');
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var prenom = capitalize(clean(input.value));
    if (!prenom) {
      form.classList.remove('is-error'); void form.offsetWidth; form.classList.add('is-error');
      input.focus();
      return;
    }
    if (!tracked && !DEMO) { // suivi de l'entonnoir (le prénom n'est pas transmis)
      tracked = true;
      try { navigator.sendBeacon && navigator.sendBeacon('/i/evt?k=continue' + (CFG.code ? '&c=' + encodeURIComponent(CFG.code) : '')); } catch (_) {}
    }
    go(prenom);
  });

  // L'orbe se contracte puis se déplie en onde vocale, et WhatsApp s'ouvre aussitôt.
  function go(prenom) {
    input.blur();
    orb.gather();
    fallback.href = waLink(prenom);
    fallback.classList.remove('is-visible');
    show(s2, s3, function () { orb.toWave(); });
    timers.forEach(clearTimeout);
    timers = [
      setTimeout(function () { if (!DEMO) window.location.replace(waLink(prenom)); }, REDIRECT_DELAY),
      // si WhatsApp ne s'ouvre pas (iOS, navigateur intégré), un bouton discret prend le relais
      setTimeout(function () { fallback.classList.add('is-visible'); }, REDIRECT_DELAY + 1800),
    ];
  }

  function reset() {
    timers.forEach(clearTimeout);
    orb.toSphere();
    [s2, s3].forEach(function (el) { el.hidden = true; el.classList.remove('is-out'); });
    s1.hidden = false; s1.classList.remove('is-out');
    input.value = '';
  }
  $('home').addEventListener('click', function (e) { e.preventDefault(); reset(); });
  fallback.addEventListener('click', function (e) { if (DEMO) e.preventDefault(); });
  addEventListener('pageshow', function (e) { if (e.persisted) fallback.classList.add('is-visible'); });

  // Aperçu : ?demo=1&step=onde&prenom=Florio montre directement l'onde, sans redirection
  if (DEMO && qs.get('step') === 'onde') { s1.hidden = true; s2.hidden = false; go(capitalize(clean(qs.get('prenom') || 'Florio'))); }
})();
