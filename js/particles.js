/**
 * MURA Particle Background
 * Lightweight canvas-based floating particles with network lines.
 * Off-white base, cyan/pink/lime blurred particles, thin grey connecting lines.
 */
(function () {
  'use strict';

  // Create the canvas element if it doesn't exist (injected instead of inline HTML)
  let canvas = document.getElementById('particle-bg');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'particle-bg';
    canvas.setAttribute('aria-hidden', 'true');
    // Insert as first child of body so CSS z-index:-1 places it behind all content.
    // Using insertBefore is more reliable than prepend for <body>.
    if (document.body.firstChild) {
      document.body.insertBefore(canvas, document.body.firstChild);
    } else {
      document.body.appendChild(canvas);
    }
  }

  const ctx = canvas.getContext('2d');

  // --- Configuration ---
  const PARTICLE_COLORS = [
    { r: 6, g: 182, b: 212 },   // cyan-500  (#06b6d4)
    { r: 236, g: 72, b: 153 },  // pink-500  (#ec4899)
    { r: 132, g: 204, b: 22 },  // lime-500  (#84cc16)
  ];

  const BASE_PARTICLE_COUNT = 35;
  const LINE_DISTANCE = 150;
  const LINE_COLOR = 'rgba(160,160,170,0.13)';
  const LINE_WIDTH = 0.6;
  const PARTICLE_RADIUS_MIN = 2.5;
  const PARTICLE_RADIUS_MAX = 5.5;
  const PARTICLE_ALPHA = 0.45;
  const GLOW_MULTIPLIER = 3.5;
  const GLOW_ALPHA = 0.12;
  const SPEED = 0.18;
  const BG_COLOR = '#f8f9fa';

  let particles = [];
  let width, height;
  let animId;

  // --- Resize ---
  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  // --- Particle class ---
  function createParticle() {
    var colorIdx = Math.floor(Math.random() * PARTICLE_COLORS.length);
    var c = PARTICLE_COLORS[colorIdx];
    var radius = PARTICLE_RADIUS_MIN + Math.random() * (PARTICLE_RADIUS_MAX - PARTICLE_RADIUS_MIN);
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * SPEED * 2,
      vy: (Math.random() - 0.5) * SPEED * 2,
      radius: radius,
      color: c,
    };
  }

  // --- Init ---
  function init() {
    resize();
    particles = [];
    // Fewer particles on small screens
    var count = width < 768 ? Math.floor(BASE_PARTICLE_COUNT * 0.55) : BASE_PARTICLE_COUNT;
    for (var i = 0; i < count; i++) {
      particles.push(createParticle());
    }
  }

  // --- Draw ---
  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Background fill
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    var len = particles.length;

    // Draw network lines first (behind particles)
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeStyle = LINE_COLOR;
    ctx.beginPath();
    for (var i = 0; i < len; i++) {
      for (var j = i + 1; j < len; j++) {
        var dx = particles[i].x - particles[j].x;
        var dy = particles[i].y - particles[j].y;
        var dist = dx * dx + dy * dy;
        if (dist < LINE_DISTANCE * LINE_DISTANCE) {
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
        }
      }
    }
    ctx.stroke();

    // Draw particles with glow
    for (var k = 0; k < len; k++) {
      var p = particles[k];
      var c = p.color;

      // Soft glow (radial gradient)
      var glowR = p.radius * GLOW_MULTIPLIER;
      var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      grad.addColorStop(0, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + GLOW_ALPHA + ')');
      grad.addColorStop(1, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Core dot
      ctx.fillStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + PARTICLE_ALPHA + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- Update ---
  function update() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      // Wrap around edges with padding
      if (p.x < -20) p.x = width + 20;
      else if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      else if (p.y > height + 20) p.y = -20;
    }
  }

  // --- Animation loop ---
  function loop() {
    update();
    draw();
    animId = requestAnimationFrame(loop);
  }

  // --- Visibility handling (pause when tab hidden) ---
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      cancelAnimationFrame(animId);
    } else {
      loop();
    }
  });

  // --- Debounced resize ---
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      // Preserve existing particles, just update canvas size
      resize();
      // Reposition any particles that are now off-screen
      for (var i = 0; i < particles.length; i++) {
        if (particles[i].x > width) particles[i].x = Math.random() * width;
        if (particles[i].y > height) particles[i].y = Math.random() * height;
      }
    }, 200);
  });

  // --- Start ---
  init();
  loop();
})();
