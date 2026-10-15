import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import * as THREE from 'three';

/**
 * Distant star background. A coarse Points cloud that drifts toward the camera
 * slowly — slower than the foreground code particles — so the tunnel has depth
 * (near-fast / far-slow parallax). The Corum palette tints each star purple,
 * cyan, or pink, with a few white ones mixed in.
 *
 * Idiomatic Remotion: positions are recomputed as a pure function of `frame`
 * from deterministic seeds, so every render of a given frame is identical
 * (no mutation-timing hazards across React reconciliation).
 */

const STAR_COUNT = 700;
const PALETTE = [0x5b21f5, 0xb98cff, 0x01cdfe, 0xff71ce, 0xffffff, 0xffffff];
const FIELD_DEPTH = 200; // total z span
const FIELD_NEAR = 20; // z at which a star is "at the camera"
const DRIFT_SPEED = 22; // units per second

/** Mulberry32 — tiny deterministic PRNG so seeds are stable across frames. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface StarSeed {
  angle: number;
  radius: number;
  z0: number; // initial z
  color: THREE.Color;
  size: number;
}

export const StarField: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Build stable seeds once.
  const seeds = useMemo<StarSeed[]>(() => {
    const rng = mulberry32(1337);
    const out: StarSeed[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < STAR_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 4 + rng() * 40;
      const z0 = -FIELD_DEPTH + rng() * (FIELD_DEPTH - FIELD_NEAR);
      c.setHex(PALETTE[Math.floor(rng() * PALETTE.length)]);
      out.push({
        angle,
        radius,
        z0,
        color: c.clone(),
        size: 0.25 + rng() * 0.3,
      });
    }
    return out;
  }, []);

  // Compute wrapped z for this frame.
  const drift = ((frame / fps) * DRIFT_SPEED) % FIELD_DEPTH;

  const positions = useMemo(() => {
    const arr = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const s = seeds[i];
      let z = s.z0 + drift;
      // wrap into [−FIELD_DEPTH, −FIELD_NEAR + small]
      while (z > -FIELD_NEAR) z -= FIELD_DEPTH;
      arr[i * 3 + 0] = Math.cos(s.angle) * s.radius;
      arr[i * 3 + 1] = Math.sin(s.angle) * s.radius;
      arr[i * 3 + 2] = z;
    }
    return arr;
  }, [seeds, drift]);

  const colors = useMemo(() => {
    const arr = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      arr[i * 3 + 0] = seeds[i].color.r;
      arr[i * 3 + 1] = seeds[i].color.g;
      arr[i * 3 + 2] = seeds[i].color.b;
    }
    return arr;
  }, [seeds]);

  // Per-star size attribute (so some stars are bigger).
  const sizes = useMemo(() => {
    const arr = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) arr[i] = seeds[i].size;
    return arr;
  }, [seeds]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={STAR_COUNT}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
          count={STAR_COUNT}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[sizes, 1]}
          count={STAR_COUNT}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.4}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.8}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};
