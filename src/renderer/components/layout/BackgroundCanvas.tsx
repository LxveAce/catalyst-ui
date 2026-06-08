import React, { useRef, useEffect, useCallback } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

interface RainDrop {
  x: number;
  y: number;
  speed: number;
  length: number;
  char: string;
  opacity: number;
}

interface GridPulse {
  x: number;
  y: number;
  phase: number;
  speed: number;
}

function getAccentColor(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--accent')
    .trim() || '#7c3aed';
}

function getAccentLightColor(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-light')
    .trim() || '#a78bfa';
}

function getBorderColor(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--border')
    .trim() || 'rgba(255,255,255,0.08)';
}

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(124,58,237,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

function parseToRgba(color: string, alpha: number): string {
  if (color.startsWith('#')) return hexToRgba(color, alpha);
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) return `rgba(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]},${alpha})`;
  return hexToRgba('#7c3aed', alpha);
}

const RAIN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*+=<>{}[]|/\\~';

function drawDots(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  particles: Particle[],
  intensity: number,
) {
  const accent = getAccentColor();
  const baseAlpha = (intensity / 100) * 0.4;
  const connectDist = 120;

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = W;
    if (p.x > W) p.x = 0;
    if (p.y < 0) p.y = H;
    if (p.y > H) p.y = 0;
  }

  ctx.strokeStyle = parseToRgba(accent, baseAlpha * 0.4);
  ctx.lineWidth = 0.5;
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < connectDist) {
        const lineAlpha = (1 - dist / connectDist) * baseAlpha * 0.5;
        ctx.strokeStyle = parseToRgba(accent, lineAlpha);
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.stroke();
      }
    }
  }

  ctx.fillStyle = parseToRgba(accent, baseAlpha);
  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  pulses: GridPulse[],
  intensity: number,
  time: number,
) {
  const border = getBorderColor();
  const baseAlpha = (intensity / 100) * 0.08;
  const spacing = 40;

  for (let x = 0; x <= W; x += spacing) {
    const pulseInfluence = pulses.reduce((acc, p) => {
      const dist = Math.abs(p.x - x);
      if (dist < 200) return acc + (1 - dist / 200) * Math.sin(time * p.speed + p.phase) * 0.5;
      return acc;
    }, 0);
    const alpha = baseAlpha + Math.abs(pulseInfluence) * baseAlpha * 2;
    ctx.strokeStyle = parseToRgba(border, Math.min(alpha, 0.15));
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  for (let y = 0; y <= H; y += spacing) {
    const pulseInfluence = pulses.reduce((acc, p) => {
      const dist = Math.abs(p.y - y);
      if (dist < 200) return acc + (1 - dist / 200) * Math.sin(time * p.speed + p.phase) * 0.5;
      return acc;
    }, 0);
    const alpha = baseAlpha + Math.abs(pulseInfluence) * baseAlpha * 2;
    ctx.strokeStyle = parseToRgba(border, Math.min(alpha, 0.15));
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  for (const p of pulses) {
    p.x += Math.cos(p.phase) * 0.3;
    p.y += Math.sin(p.phase) * 0.3;
    if (p.x < 0 || p.x > W) p.phase = Math.PI - p.phase;
    if (p.y < 0 || p.y > H) p.phase = -p.phase;
  }
}

function drawRain(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  drops: RainDrop[],
  intensity: number,
) {
  const accentLight = getAccentLightColor();
  const baseAlpha = 0.03 + (intensity / 100) * 0.03;

  ctx.font = '12px monospace';

  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.y += d.speed;

    if (d.y > H + 20) {
      drops[i] = {
        x: Math.random() * W,
        y: -20,
        speed: 1 + Math.random() * 3,
        length: 4 + Math.floor(Math.random() * 12),
        char: RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)],
        opacity: 0.5 + Math.random() * 0.5,
      };
      continue;
    }

    for (let j = 0; j < d.length; j++) {
      const charY = d.y - j * 14;
      if (charY < -14 || charY > H + 14) continue;
      const fadeAlpha = (1 - j / d.length) * baseAlpha * d.opacity;
      ctx.fillStyle = parseToRgba(accentLight, fadeAlpha);
      const ch = j === 0
        ? RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)]
        : d.char;
      ctx.fillText(ch, d.x, charY);
    }
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  particles: Particle[],
  intensity: number,
) {
  const accent = getAccentColor();
  const baseAlpha = (intensity / 100) * 0.35;

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;

    if (p.life <= 0 || p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) {
      p.x = Math.random() * W;
      p.y = Math.random() * H;
      p.vx = (Math.random() - 0.5) * 0.4;
      p.vy = (Math.random() - 0.5) * 0.4;
      p.life = p.maxLife;
    }

    const lifeRatio = p.life / p.maxLife;
    const fade = lifeRatio < 0.2 ? lifeRatio / 0.2 : lifeRatio > 0.8 ? (1 - lifeRatio) / 0.2 : 1;
    const alpha = baseAlpha * fade;

    ctx.fillStyle = parseToRgba(accent, alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + fade * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
}

function initDotsParticles(W: number, H: number, count: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      life: 1,
      maxLife: 1,
      size: 1 + Math.random() * 1.5,
    });
  }
  return particles;
}

function initGridPulses(W: number, H: number): GridPulse[] {
  const pulses: GridPulse[] = [];
  for (let i = 0; i < 5; i++) {
    pulses.push({
      x: Math.random() * W,
      y: Math.random() * H,
      phase: Math.random() * Math.PI * 2,
      speed: 0.01 + Math.random() * 0.02,
    });
  }
  return pulses;
}

function initRainDrops(W: number, H: number, count: number): RainDrop[] {
  const drops: RainDrop[] = [];
  for (let i = 0; i < count; i++) {
    drops.push({
      x: Math.random() * W,
      y: Math.random() * H,
      speed: 1 + Math.random() * 3,
      length: 4 + Math.floor(Math.random() * 12),
      char: RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)],
      opacity: 0.5 + Math.random() * 0.5,
    });
  }
  return drops;
}

function initFloatingParticles(W: number, H: number, count: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const maxLife = 300 + Math.random() * 400;
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      life: Math.random() * maxLife,
      maxLife,
      size: 1 + Math.random() * 2,
    });
  }
  return particles;
}

export function BackgroundCanvas({ pattern, intensity }: { pattern: string; intensity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    dotsParticles: Particle[];
    gridPulses: GridPulse[];
    rainDrops: RainDrop[];
    floatingParticles: Particle[];
    time: number;
    initialized: string;
  }>({
    dotsParticles: [],
    gridPulses: [],
    rainDrops: [],
    floatingParticles: [],
    time: 0,
    initialized: '',
  });

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  useEffect(() => {
    if (pattern === 'none') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    resizeCanvas();

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;

    const state = stateRef.current;
    if (state.initialized !== pattern) {
      const densityScale = Math.max(0.3, intensity / 100);
      switch (pattern) {
        case 'dots':
          state.dotsParticles = initDotsParticles(W(), H(), Math.floor(60 * densityScale + 20));
          break;
        case 'grid':
          state.gridPulses = initGridPulses(W(), H());
          break;
        case 'rain':
          state.rainDrops = initRainDrops(W(), H(), Math.floor(40 * densityScale + 10));
          break;
        case 'particles':
          state.floatingParticles = initFloatingParticles(W(), H(), Math.floor(70 * densityScale + 15));
          break;
      }
      state.initialized = pattern;
      state.time = 0;
    }

    let frameId: number;
    const onResize = () => {
      resizeCanvas();
      const s = stateRef.current;
      const densityScale = Math.max(0.3, intensity / 100);
      if (pattern === 'dots') s.dotsParticles = initDotsParticles(W(), H(), Math.floor(60 * densityScale + 20));
      if (pattern === 'grid') s.gridPulses = initGridPulses(W(), H());
      if (pattern === 'rain') s.rainDrops = initRainDrops(W(), H(), Math.floor(40 * densityScale + 10));
      if (pattern === 'particles') s.floatingParticles = initFloatingParticles(W(), H(), Math.floor(70 * densityScale + 15));
    };
    window.addEventListener('resize', onResize);

    const animate = () => {
      const w = W();
      const h = H();
      ctx.clearRect(0, 0, w, h);
      state.time += 0.016;

      switch (pattern) {
        case 'dots':
          drawDots(ctx, w, h, state.dotsParticles, intensity);
          break;
        case 'grid':
          drawGrid(ctx, w, h, state.gridPulses, intensity, state.time);
          break;
        case 'rain':
          drawRain(ctx, w, h, state.rainDrops, intensity);
          break;
        case 'particles':
          drawParticles(ctx, w, h, state.floatingParticles, intensity);
          break;
      }

      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
    };
  }, [pattern, intensity, resizeCanvas]);

  useEffect(() => {
    const state = stateRef.current;
    if (state.initialized && state.initialized !== pattern) {
      state.initialized = '';
    }
  }, [pattern]);

  if (pattern === 'none') return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
