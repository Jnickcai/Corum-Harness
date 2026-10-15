import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import * as THREE from 'three';

/**
 * "Corum Harness" title that fades in during phase 2 and stays through phase 3.
 *
 * Implementation: the text is rasterized once onto a CanvasTexture (white text
 * with a purple glow), mapped onto a Three.js plane placed near the camera so
 * it lives inside the same 3D scene as the converging particles. The plane's
 * material opacity is driven by `useCurrentFrame()`, so it eases from 0 → 1
 * across phase 2 while the particles are converging and fading out.
 *
 * A soft purple point light sits just behind the plane so the convergence has
 * a believable light source to fly into.
 */

const FADE_START = 120; // phase 2 begin
const FADE_END = 168; // fully visible a touch before phase 3
const PLANE_Z = -8;

export const TextConverge: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // purple glow behind the text
    const grad = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      40,
      canvas.width / 2,
      canvas.height / 2,
      canvas.width / 2,
    );
    grad.addColorStop(0, 'rgba(91,33,245,0.55)');
    grad.addColorStop(0.4, 'rgba(91,33,245,0.22)');
    grad.addColorStop(1, 'rgba(91,33,245,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // the title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 200px "Inter", "Segoe UI", system-ui, sans-serif';
    // outer glow
    ctx.shadowColor = 'rgba(185,140,255,0.95)';
    ctx.shadowBlur = 60;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Corum Harness', canvas.width / 2, canvas.height / 2);
    // crisp white core on top
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Corum Harness', canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    return tex;
  }, []);

  // fade in during phase 2
  const opacity =
    frame < FADE_START
      ? 0
      : frame > FADE_END
        ? 1
        : interpolate(frame, [FADE_START, FADE_END], [0, 1], {
            easing: Easing.out(Easing.cubic),
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });

  // subtle scale-in (0.92 → 1) for a "settling" feel
  const scale =
    frame < FADE_START
      ? 0.92
      : frame > FADE_END
        ? 1
        : interpolate(frame, [FADE_START, FADE_END], [0.92, 1], {
            easing: Easing.out(Easing.cubic),
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });

  // size the plane to roughly match a 16:9 letterboxed title
  const planeHeight = 3.2;
  const planeWidth = planeHeight * (2048 / 512); // 12.8

  // aspect guard so it never overflows the 16:9 frame
  const fitWidth = Math.min(planeWidth, (planeHeight * width) / height);

  return (
    <group>
      {/* purple backlight behind the title */}
      <pointLight
        position={[0, 0, PLANE_Z - 2]}
        color={0xb98cff}
        intensity={6}
        distance={20}
        decay={2}
      />
      <mesh position={[0, 0, PLANE_Z]} scale={[fitWidth * scale, planeHeight * scale, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={opacity}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
};
