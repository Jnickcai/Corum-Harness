import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  Easing,
} from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import * as THREE from 'three';
import { StarField } from './StarField';
import { CodeParticles } from './CodeParticles';
import { TextConverge } from './TextConverge';
import { ARPEGGIO_START_FRAME } from './audio';

/**
 * Corum startup animation — 3D first-person star/code tunnel → code fragments
 * converge → "Corum Harness" title → ready state.
 *
 * Timeline (30 fps × 8s = 240 frames):
 *   Phase 1  星际穿梭     0–120   (0s–4s)   Three.js tunnel flight
 *   Phase 2  汇聚过渡     120–180 (4s–6s)   particles converge + fade, title in
 *   Phase 3  就绪展示     180–240 (6s–8s)   title holds, tagline + progress + 就绪
 *
 * The 3D layers (StarField, CodeParticles, TextConverge) share one ThreeCanvas
 * so depth sorting and additive blending compose naturally. Phase-3 HTML
 * overlays sit on top of the canvas via an AbsoluteFill + z-index.
 */

export const StartupAnimation: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();

  // --- background gradient lerp (#0A0612 → #120820), darkest at the start ---
  const bgT = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const bgColor = lerpColor('#0A0612', '#120820', bgT);

  // --- phase 3 overlay fades ------------------------------------------------
  const phase3Start = 180;
  const taglineOpacity = interpolate(frame, [phase3Start + 6, phase3Start + 26], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const progressOpacity = interpolate(frame, [phase3Start + 12, phase3Start + 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // progress bar fills across phase 3 (already "full" per spec, animate the fill)
  const progressFill = interpolate(frame, [phase3Start, phase3Start + 54], [0.0, 1.0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const readyLabelOpacity = interpolate(frame, [phase3Start + 30, phase3Start + 44], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // a subtle vignette pulse to keep phase 3 alive
  const vignettePulse = 0.45 + 0.12 * Math.sin((frame / fps) * Math.PI * 1.5);

  return (
    <AbsoluteFill style={{ backgroundColor: bgColor, overflow: 'hidden' }}>
      {/* ============ 3D scene (phases 1–2 + title hold in 3) ============ */}
      <ThreeCanvas
        width={width}
        height={height}
        camera={{ position: [0, 0, 0], fov: 75, near: 0.1, far: 1000 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        style={{ width: '100%', height: '100%' }}
      >
        {/* ambient so nothing is pure black */}
        <ambientLight intensity={0.35} color={new THREE.Color(0x1a1030)} />
        {/* the tunnel: stars + code particles */}
        <StarField />
        <CodeParticles />
        {/* the title appears in phase 2, holds in phase 3 */}
        <TextConverge />
        {/* a faint fog so far particles melt into the background */}
        <fog attach="fog" args={[0x0a0612, 30, 180]} />
      </ThreeCanvas>

      {/* ============ Phase-3 HTML overlays ============ */}
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {/* tagline */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '58%',
            textAlign: 'center',
            opacity: taglineOpacity,
            transform: `translateY(${(1 - taglineOpacity) * 12}px)`,
            fontFamily: '"Inter","Segoe UI",system-ui,sans-serif',
            fontSize: 34,
            letterSpacing: '0.08em',
            color: '#01CDFE',
            textShadow: '0 0 18px rgba(1,205,254,0.55)',
          }}
        >
          立矩成道 · Agent 成团开发
        </div>

        {/* progress bar */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '72%',
            width: 560,
            marginLeft: -280,
            opacity: progressOpacity,
          }}
        >
          <div
            style={{
              height: 6,
              borderRadius: 3,
              background: 'rgba(123,104,150,0.28)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progressFill * 100}%`,
                height: '100%',
                borderRadius: 3,
                background:
                  'linear-gradient(90deg, #5B21F5 0%, #B98CFF 100%)',
                boxShadow: '0 0 12px rgba(185,140,255,0.7)',
              }}
            />
          </div>
        </div>

        {/* 就绪 stage label */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '78%',
            textAlign: 'center',
            opacity: readyLabelOpacity,
            fontFamily: '"JetBrains Mono","Fira Code",monospace',
            fontSize: 18,
            letterSpacing: '0.4em',
            color: '#7B6896',
            textTransform: 'uppercase',
          }}
        >
          就 绪 · READY
        </div>
      </AbsoluteFill>

      {/* ============ audio: ascending arpeggio in phase 3 ============ */}
      <Sequence from={ARPEGGIO_START_FRAME} durationInFrames={durationInFrames - ARPEGGIO_START_FRAME}>
        <Audio src={staticFile('arpeggio.wav')} volume={1} />
      </Sequence>

      {/* vignette overlay for depth */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(10,6,18,${vignettePulse}) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Linear- interpolate between two hex colors. */
function lerpColor(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
