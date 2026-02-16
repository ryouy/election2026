(function () {
  'use strict';

  window.App = window.App || {};
  App.textures = App.textures || {};

  function hexToRgba(hex, a) {
    const h = (hex || '#ffffff').replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function createRingTexture(color) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    const center = size / 2;
    const r = size / 2 - 10;
    ctx.arc(center, center, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.stroke();

    // subtle glow
    ctx.beginPath();
    ctx.arc(center, center, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    return new THREE.CanvasTexture(canvas);
  }

  function createHaloTexture(color) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.5);
    g.addColorStop(0.0, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.35, hexToRgba(color, 0.28));
    g.addColorStop(0.55, hexToRgba(color, 0.12));
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  function createShapeTexture(type, color) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    const center = size / 2;
    const radius = size / 2 - 10;
    ctx.beginPath();
    if (type === 0) ctx.arc(center, center, radius, 0, Math.PI * 2);
    else if (type === 1) ctx.rect(10, 10, size - 20, size - 20);
    else if (type === 2) {
      ctx.moveTo(center, 10);
      ctx.lineTo(size - 10, size - 10);
      ctx.lineTo(10, size - 10);
      ctx.closePath();
    } else if (type === 3) {
      ctx.moveTo(center, 10);
      ctx.lineTo(size - 10, center);
      ctx.lineTo(center, size - 10);
      ctx.lineTo(10, center);
      ctx.closePath();
    }
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
  }

  function createTextTexture(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 64;
    ctx.font = "bold " + fontSize + "px 'Noto Sans JP', sans-serif";
    const textMetrics = ctx.measureText(text);
    canvas.width = textMetrics.width + 10;
    canvas.height = fontSize + 10;
    ctx.font = "bold " + fontSize + "px 'Noto Sans JP', sans-serif";
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 5, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return { texture, width: canvas.width, height: canvas.height };
  }

  App.textures.hexToRgba = hexToRgba;
  App.textures.createRingTexture = createRingTexture;
  App.textures.createHaloTexture = createHaloTexture;
  App.textures.createShapeTexture = createShapeTexture;
  App.textures.createTextTexture = createTextTexture;
})();


