"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  size: number;
}

const COLORS = ["#121212", "#fafafa", "#008834", "#CB9C00", "#121212"];

export function SuccessParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const cx = canvas.width / 2;
    const cy = canvas.height * 0.3;

    const particles: Particle[] = Array.from({ length: 56 }, () => ({
      x: cx,
      y: cy,
      vx: (Math.random() - 0.5) * 9,
      vy: (Math.random() - 1.3) * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 1,
      size: 3 + Math.random() * 5,
    }));

    let raf: number;

    function tick() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      let alive = false;
      for (const p of particles) {
        if (p.life <= 0) continue;
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.22;
        p.vx *= 0.98;
        p.life -= 0.02;
        ctx!.globalAlpha = Math.max(0, p.life);
        ctx!.fillStyle = p.color;
        ctx!.fillRect(p.x, p.y, p.size, p.size * 0.55);
      }
      ctx!.globalAlpha = 1;
      if (alive) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}
