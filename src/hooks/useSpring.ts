"use client";

// ============================================
// Flash UI — Micro Spring Physics
// ============================================
// Lightweight spring animations using requestAnimationFrame.
// No external dependencies. GPU-only (transform + opacity).
//
// Spring model: critically-damped spring
//   x'' = -stiffness * (x - target) - damping * x'
//
// All hooks return CSS transform values for direct style binding.

import { useRef, useEffect, useCallback, useState } from "react";

// ---- Spring Solver ----

interface SpringState {
  value: number;
  velocity: number;
}

function stepSpring(state: SpringState, target: number, stiffness: number, damping: number, dt: number): SpringState {
  const displacement = state.value - target;
  const springForce = -stiffness * displacement;
  const dampingForce = -damping * state.velocity;
  const acceleration = springForce + dampingForce;
  const velocity = state.velocity + acceleration * dt;
  const value = state.value + velocity * dt;
  return { value, velocity };
}

function isSettled(state: SpringState, target: number): boolean {
  return Math.abs(state.value - target) < 0.001 && Math.abs(state.velocity) < 0.001;
}

// ---- useSpringValue: animate a single number ----

export function useSpringValue(target: number, config: { stiffness?: number; damping?: number } = {}): number {
  const { stiffness = 300, damping = 22 } = config;
  const [current, setCurrent] = useState(target);
  const stateRef = useRef<SpringState>({ value: target, velocity: 0 });
  const rafRef = useRef<number>(0);
  const targetRef = useRef(target);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    targetRef.current = target;

    if (rafRef.current) return; // Already animating

    lastTimeRef.current = performance.now();

    function tick(now: number) {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.064); // Cap at ~15fps minimum
      lastTimeRef.current = now;

      stateRef.current = stepSpring(stateRef.current, targetRef.current, stiffness, damping, dt);

      if (isSettled(stateRef.current, targetRef.current)) {
        stateRef.current = { value: targetRef.current, velocity: 0 };
        setCurrent(targetRef.current);
        rafRef.current = 0;
        return;
      }

      setCurrent(stateRef.current.value);
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [target, stiffness, damping]);

  return current;
}

// ---- useMagneticHover: element follows cursor within bounds ----

export function useMagneticHover(maxOffset = 6) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / rect.width;
      const dy = (e.clientY - cy) / rect.height;
      setOffset({
        x: dx * maxOffset,
        y: dy * maxOffset,
      });
    },
    [maxOffset],
  );

  const handleMouseLeave = useCallback(() => {
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("mousemove", handleMouseMove);
    el.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      el.removeEventListener("mousemove", handleMouseMove);
      el.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [handleMouseMove, handleMouseLeave]);

  // Spring-smoothed offset
  const sx = useSpringValue(offset.x, { stiffness: 250, damping: 18 });
  const sy = useSpringValue(offset.y, { stiffness: 250, damping: 18 });

  return { ref, style: { transform: `translate3d(${sx}px, ${sy}px, 0)` } };
}

// ---- useNumberSpring: smooth number transitions ----

export function useNumberSpring(value: number, config?: { stiffness?: number; damping?: number }): number {
  return useSpringValue(value, { stiffness: 200, damping: 25, ...config });
}

// ---- useBounceIn: scale 0.98 → 1.02 → 1 on mount ----

export function useBounceIn() {
  const [phase, setPhase] = useState<"start" | "overshoot" | "settle">("start");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("overshoot"), 60);
    const t2 = setTimeout(() => setPhase("settle"), 180);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const scale = phase === "start" ? 0.98 : phase === "overshoot" ? 1.02 : 1;
  const springScale = useSpringValue(scale, { stiffness: 350, damping: 20 });

  return { transform: `scale(${springScale})` };
}
