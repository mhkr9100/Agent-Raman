"use client";
// The picture behind the page: one beam goes into one prism and leaves as one ray per need. The picture is the
// progress display: rays appear as needs are found, a ray is pale while its need is open, takes its colour when
// the need is settled, and stops short when nothing could be found for it. Drawn on a canvas; it is decoration
// for screen readers (the caption in stage.tsx carries the same information as text).
import { useEffect, useRef } from "react";

export interface Ray { id: string; status: string }
export type Mode = "idle" | "running" | "paused" | "burst" | "done";

type RGB = [number, number, number];
interface Line { angle: number; grow: number; reach: number; alpha: number; rgb: RGB; open: boolean }
interface Photon { seg: 0 | 1 | 2; d: number; v: number; off: number; line: Line | null }

const LASER: RGB = [63, 224, 160];
// Colours match --laser, --stokes, --person and --gap in globals.css.
const TONE: Record<string, { rgb: RGB; alpha: number; reach: number }> = {
  bound: { rgb: LASER, alpha: 1, reach: 1 },
  low_confidence: { rgb: LASER, alpha: 0.5, reach: 1 },
  build: { rgb: [243, 181, 74], alpha: 1, reach: 1 },
  human: { rgb: [157, 176, 255], alpha: 1, reach: 1 },
  unresolved: { rgb: [255, 106, 92], alpha: 1, reach: 0.26 },
  unverified: { rgb: [255, 106, 92], alpha: 0.8, reach: 0.26 },
  pending: { rgb: [214, 218, 230], alpha: 0.5, reach: 1 },
};
const MAX_RAYS = 48;
const MAX_PHOTONS = 240;
const RATE: Record<Mode, number> = { idle: 3, running: 34, paused: 0, burst: 110, done: 5 }; // photons per second
const LEVEL: Record<Mode, number> = { idle: 0.6, running: 1, paused: 0.55, burst: 2.2, done: 0.5 };
const SWEEP = new Set(["obstacles", "critic", "finalize"]);
// The resting picture before a task is given: a plain spectrum.
const GHOST: RGB[] = [[255, 106, 92], [243, 181, 74], [236, 226, 120], [63, 224, 160], [90, 200, 235], [157, 176, 255], [196, 150, 255]];

const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export default function Scatter({ rays, mode, phase }: { rays: Ray[]; mode: Mode; phase: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ rays, mode, phase });
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    live.current = { rays, mode, phase };
    redraw.current();
  }, [rays, mode, phase]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const state = new Map<string, Line>();
    const ghosts: Line[] = GHOST.map((rgb) => ({ angle: 0, grow: 1, reach: 1, alpha: 0, rgb, open: false }));
    const photons: Photon[] = [];
    const waves: number[] = [];
    let w = 0, h = 0, raf = 0, last = performance.now(), level = LEVEL.idle, ghost = 1, owed = 0, waveClock = 0;

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const paint = (now: number, dt: number) => {
      const { rays, mode, phase } = live.current;
      const to = (cur: number, target: number, rate: number) => (still ? target : cur + (target - cur) * Math.min(1, dt * rate));

      // Geometry: the prism sits a little above the middle; the beam comes in from the lower left.
      const s = Math.max(46, Math.min(w, h) * 0.105);
      const cx = w < 720 ? w * 0.4 : w * 0.5, cy = h * 0.41;
      const ax = cx, ay = cy - s, blx = cx - 0.95 * s, bly = cy + 0.68 * s, brx = cx + 0.95 * s;
      const ex = (ax + blx) / 2, ey = (ay + bly) / 2; // where the beam enters
      const xx = (ax + brx) / 2, xy = ey; // where the rays leave
      const sx = 0, sy = ey + ex * 0.2;
      const inLen = Math.hypot(ex - sx, ey - sy), midLen = xx - ex;
      const full = (a: number) => {
        const lx = (w - xx) / Math.max(0.05, Math.cos(a));
        const ly = Math.sin(a) > 0.01 ? (h - xy) / Math.sin(a) : Math.sin(a) < -0.01 ? xy / -Math.sin(a) : Infinity;
        return Math.min(lx, ly) + 24;
      };

      // Rays follow the needs: new ones grow out, removed ones draw back in.
      const shown = rays.slice(0, MAX_RAYS);
      const n = shown.length;
      const base = 0.14, spread = Math.min(1.15, 0.2 + 0.05 * n);
      const seen = new Set<string>();
      shown.forEach((r, i) => {
        const tone = TONE[r.status] ?? TONE.pending;
        const target = n === 1 ? base : base + spread * (i / (n - 1) - 0.5);
        let l = state.get(r.id);
        if (!l) {
          l = { angle: target, grow: 0, reach: tone.reach, alpha: tone.alpha, rgb: [...tone.rgb], open: true };
          state.set(r.id, l);
        }
        l.open = r.status === "pending";
        l.grow = to(l.grow, 1, 2.2);
        l.angle = to(l.angle, target, 4);
        l.reach = to(l.reach, tone.reach, 3);
        l.alpha = to(l.alpha, tone.alpha, 3);
        for (let c = 0; c < 3; c++) l.rgb[c] = to(l.rgb[c], tone.rgb[c], 3);
        seen.add(r.id);
      });
      for (const [id, l] of state) {
        if (seen.has(id)) continue;
        l.grow = to(l.grow, 0, 5);
        if (l.grow < 0.02) state.delete(id);
      }
      const lines = [...state.values()];
      level = to(level, LEVEL[mode], 3);
      ghost = to(ghost, lines.length ? 0 : mode === "idle" ? 1 : 0.55, 2.5);
      ghosts.forEach((g, i) => {
        g.angle = base + 0.5 * (i / (ghosts.length - 1) - 0.5);
        g.alpha = ghost * (0.2 + (still ? 0 : 0.07 * Math.sin(now / 900 + i)));
      });
      const targets = lines.length ? lines : ghosts;

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      const stroke = (x1: number, y1: number, x2: number, y2: number, style: string | CanvasGradient, width: number) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      };
      const ray = (l: Line, i: number) => {
        const shimmer = l.open && !still ? 0.55 + 0.45 * Math.sin(now / 320 + i * 1.7) : 1;
        const a = l.alpha * shimmer * Math.min(1.25, 0.45 + level * 0.6);
        const len = full(l.angle) * l.reach * l.grow;
        const x2 = xx + Math.cos(l.angle) * len, y2 = xy + Math.sin(l.angle) * len;
        const fade = ctx.createLinearGradient(xx, xy, x2, y2);
        fade.addColorStop(0, rgba(l.rgb, a));
        fade.addColorStop(1, rgba(l.rgb, a * (l.reach < 0.9 ? 0.55 : 0.1)));
        const halo = ctx.createLinearGradient(xx, xy, x2, y2);
        halo.addColorStop(0, rgba(l.rgb, a * 0.16));
        halo.addColorStop(1, rgba(l.rgb, 0));
        stroke(xx, xy, x2, y2, halo, 9);
        stroke(xx, xy, x2, y2, fade, 1.6);
        if (l.reach < 0.9 && l.grow > 0.9) {
          // A ray that stops short: nothing was found for this need.
          ctx.strokeStyle = rgba(l.rgb, a * 0.9);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(x2, y2, 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      };

      // Beam in, and through the glass.
      stroke(sx, sy, ex, ey, rgba(LASER, 0.07 * level), 12);
      stroke(sx, sy, ex, ey, rgba(LASER, 0.55 * Math.min(1.4, level)), 1.8);
      stroke(ex, ey, xx, xy, rgba([200, 255, 232], 0.3 * Math.min(1.4, level)), 1.4);

      if (ghost > 0.01) ghosts.forEach(ray);
      lines.forEach(ray);

      // Wave fronts sweep the fan while the whole plan is being checked.
      if (!still && mode === "running" && SWEEP.has(phase) && lines.length) {
        waveClock += dt;
        if (waveClock > 0.9) { waveClock = 0; waves.push(0); }
      }
      const reach = Math.hypot(w - xx, h - xy);
      for (let i = waves.length - 1; i >= 0; i--) {
        waves[i] += 420 * dt;
        if (waves[i] > reach) { waves.splice(i, 1); continue; }
        ctx.strokeStyle = rgba([233, 231, 224], 0.14 * (1 - waves[i] / reach));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(xx, xy, waves[i], base - spread / 2 - 0.06, base + spread / 2 + 0.06);
        ctx.stroke();
      }

      // Photons: beam, glass, then one of the rays.
      if (!still) {
        owed += RATE[mode] * dt;
        while (owed >= 1 && photons.length < MAX_PHOTONS) {
          owed -= 1;
          photons.push({ seg: 0, d: 0, v: (mode === "idle" || mode === "done" ? 240 : 520) * (0.75 + Math.random() * 0.5), off: (Math.random() - 0.5) * 3, line: null });
        }
        if (owed > 2) owed = 2;
        for (let i = photons.length - 1; i >= 0; i--) {
          const p = photons[i];
          p.d += p.v * dt;
          if (p.seg === 0 && p.d >= inLen) { p.seg = 1; p.d -= inLen; }
          if (p.seg === 1 && p.d >= midLen) { p.seg = 2; p.d -= midLen; p.line = targets[Math.floor(Math.random() * targets.length)] ?? null; }
          let x = 0, y = 0, c: RGB = LASER, a = 0.9;
          if (p.seg === 0) {
            const t = p.d / inLen;
            x = sx + (ex - sx) * t;
            y = sy + (ey - sy) * t + p.off;
          } else if (p.seg === 1) {
            x = ex + p.d;
            y = ey + p.off * 0.4;
            c = [210, 255, 236];
          } else {
            const l = p.line;
            const len = l ? full(l.angle) * l.reach * l.grow : 0;
            if (!l || p.d >= len) { photons.splice(i, 1); continue; }
            x = xx + Math.cos(l.angle) * p.d;
            y = xy + Math.sin(l.angle) * p.d;
            c = l.rgb;
            a = 0.9 * Math.max(0.25, l.alpha) * (1 - (p.d / len) * (l.reach < 0.9 ? 0.2 : 0.75));
          }
          ctx.fillStyle = rgba(c, a * 0.22);
          ctx.beginPath();
          ctx.arc(x, y, 4.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = rgba(c, a);
          ctx.beginPath();
          ctx.arc(x, y, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // The prism, with a glow that follows the work.
      const beat = still ? 0.5 : mode === "running" || mode === "burst" ? 0.5 + 0.5 * Math.sin(now / 240) : 0.35;
      const glow = ctx.createRadialGradient(cx, cy + s * 0.1, 0, cx, cy + s * 0.1, s * (1.6 + level * 0.9));
      glow.addColorStop(0, rgba([200, 255, 232], 0.1 * level * (0.6 + beat * 0.6)));
      glow.addColorStop(1, rgba([200, 255, 232], 0));
      ctx.fillStyle = glow;
      ctx.fillRect(cx - s * 4.5, cy - s * 4.5, s * 9, s * 9);
      ctx.globalCompositeOperation = "source-over";
      const seenPrism = mode === "done" ? 0.35 : 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(brx, bly);
      ctx.lineTo(blx, bly);
      ctx.closePath();
      const glass = ctx.createLinearGradient(blx, bly, brx, ay);
      glass.addColorStop(0, rgba([233, 231, 224], 0.02 * seenPrism));
      glass.addColorStop(1, rgba([233, 231, 224], 0.09 * seenPrism));
      ctx.fillStyle = glass;
      ctx.fill();
      ctx.lineJoin = "round";
      ctx.strokeStyle = rgba([233, 231, 224], (0.5 + 0.25 * beat) * seenPrism);
      ctx.lineWidth = 1.25;
      ctx.stroke();
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      paint(now, dt);
      raf = requestAnimationFrame(loop);
    };
    const observer = new ResizeObserver(() => {
      size();
      if (still) paint(performance.now(), 0);
    });
    observer.observe(el);
    size();
    // With reduced motion there is no loop: one still frame each time something changes.
    redraw.current = () => { if (still) paint(performance.now(), 0); };
    if (still) paint(performance.now(), 0);
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      redraw.current = () => {};
    };
  }, []);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" />;
}
