import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import * as THREE from 'three';

/**
 * Code-fragment particle system.
 *
 * Each particle is a real code token (from the Corum vocabulary) drawn onto a
 * small CanvasTexture and mapped onto a Three.js Sprite. Sprites always face
 * the camera, so tokens stay readable while they fly down the z-axis.
 *
 *   Phase 1 (0–120):   particles fly from far (−z) toward the camera, growing
 *                      as they approach (perspective: near = big+fast,
 *                      far = small+slow). They recycle past the camera.
 *   Phase 2 (120–180): particles ease-converge toward the screen center
 *                      (x,y → 0, z → a fixed near plane) and fade out.
 *
 * Particle count is kept modest (~140) because each is a textured sprite; the
 * token atlas is a single shared texture so draw calls stay cheap.
 */

// --- the Corum code vocabulary ----------------------------------------------
const CODE_WORDS = [
  'const', 'async', 'await', 'return', 'import', 'export', 'class',
  'function', '=>', 'if', 'else', 'for', 'while', 'try', 'catch', 'throw',
  'new', 'typeof', 'interface', 'type', 'extends', 'implements', 'static',
  'readonly', 'public', 'private', 'void', 'null', 'undefined', 'true',
  'false', 'this', 'super', 'yield', 'break', 'continue', 'switch', 'case',
  'default', 'let', 'var', 'do', 'in', 'of', 'instanceof', 'Cordis', 'corum',
  'Agent', 'preset', 'inject', 'provide', 'Remote', 'slot', 'bundle',
  'plugin', 'compile', 'boot', 'spawn', 'fork', 'verify', 'CDP', 'RPC',
  'MCP', 'ctx', 'config', 'manifest', 'deploy', 'closure', 'scope',
  'session', 'workspace', 'trait', 'persona', 'skill', 'model', 'tool',
  'guard', 'perm', 'sandbox', 'override', 'vite', 'tsc', 'tsdown', 'vitest',
  'pnpm', 'electron', 'react', 'typescript', 'ESM', 'CJS',
];

const PARTICLE_COUNT = 140;
const PALETTE = [0xb98cff, 0x01cdfe, 0xff71ce, 0x5b21f5, 0xffffff];
const TUNNEL_DEPTH = 220; // z span particles travel
const NEAR_Z = 6; // z at which a particle is right at the camera
const DRIFT_SPEED = 46; // units per second

/** Mulberry32 PRNG for stable per-particle seeds across frames. */
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

interface ParticleSeed {
  angle: number;
  radius: number;
  z0: number;
  word: string;
  colorIdx: number;
  scale: number;
}

/**
 * Build ONE shared texture atlas containing every code word, each tinted with
 * every palette color. We lay them out in a grid; each particle samples its
 * own cell via its UV offset. This keeps it to a single material/draw batch.
 *
 * Grid: columns = words, rows = palette colors. Cell size ~ 128×48 px.
 */
function buildAtlasTexture(): {
  texture: THREE.CanvasTexture;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
} {
  const cellW = 128;
  const cellH = 48;
  const cols = CODE_WORDS.length;
  const rows = PALETTE.length;
  const canvas = document.createElement('canvas');
  canvas.width = cellW * cols;
  canvas.height = cellH * rows;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 26px "JetBrains Mono", "Fira Code", "Courier New", monospace';

  const toCss = (hex: number) => {
    const r = (hex >> 16) & 255;
    const g = (hex >> 8) & 255;
    const b = hex & 255;
    return `rgb(${r},${g},${b})`;
  };

  for (let r = 0; r < rows; r++) {
    const color = toCss(PALETTE[r]);
    for (let c = 0; c < cols; c++) {
      const x = c * cellW + cellW / 2;
      const y = r * cellH + cellH / 2;
      // subtle glow
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = color;
      ctx.fillText(CODE_WORDS[c], x, y);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return { texture, cellW, cellH, cols, rows };
}

/**
 * Custom sprite material that picks a cell from the atlas based on per-particle
 * `aCellU / aCellV` attributes, instead of sampling the whole texture.
 *
 * We use a ShaderMaterial (Points) so all particles share one draw call. Each
 * point is a textured quad (via `gl_PointSize`) — but for crisp text we instead
 * render a small set of <Sprite> elements is heavy, so we go with Points +
 * a fragment shader that samples the atlas cell. Point sprites support varies,
 * but Chromium (which renders Remotion) always supports them well.
 */
const VERT = /* glsl */ `
  attribute float aScale;
  attribute float aCellU;
  attribute float aCellV;
  attribute float aOpacity;
  varying vec2 vCellOffset;
  varying float vOpacity;
  void main() {
    vCellOffset = vec2(aCellU, aCellV);
    vOpacity = aOpacity;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // size scales with closeness: nearer (smaller |z|) → bigger
    float dist = -mv.z;
    float size = aScale * 240.0 / max(dist, 1.0);
    gl_PointSize = clamp(size, 1.0, 200.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  // atlas cell sampling. uCellSize = (1/cols, 1/rows) in UV space.
  uniform sampler2D uAtlas;
  uniform vec2 uCellSize;
  varying vec2 vCellOffset;
  varying float vOpacity;
  void main() {
    // gl_PointCoord is 0..1 across the point sprite.
    vec2 within = gl_PointCoord;
    // map into the chosen atlas cell
    vec2 uv = vCellOffset + within * uCellSize;
    vec4 texel = texture2D(uAtlas, uv);
    if (texel.a < 0.05) discard;
    gl_FragColor = vec4(texel.rgb, texel.a * vOpacity);
  }
`;

export const CodeParticles: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // --- build atlas + seeds once --------------------------------------------
  const atlas = useMemo(buildAtlasTexture, []);
  const seeds = useMemo<ParticleSeed[]>(() => {
    const rng = mulberry32(99);
    const out: ParticleSeed[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      out.push({
        angle: rng() * Math.PI * 2,
        radius: 3 + rng() * 26,
        z0: -TUNNEL_DEPTH + rng() * (TUNNEL_DEPTH - NEAR_Z),
        word: CODE_WORDS[Math.floor(rng() * CODE_WORDS.length)],
        colorIdx: Math.floor(rng() * PALETTE.length),
        scale: 0.6 + rng() * 1.1,
      });
    }
    return out;
  }, []);

  // uniform: atlas cell size in UV space
  const uniforms = useMemo(
    () => ({
      uAtlas: { value: atlas.texture },
      uCellSize: {
        value: new THREE.Vector2(1 / atlas.cols, 1 / atlas.rows),
      },
    }),
    [atlas],
  );

  // --- phase weights ------------------------------------------------------
  // phase 1: full fly. phase 2: converge + fade.
  const phase2Start = 120;
  const phase2End = 180;

  // --- compute per-frame positions, scales, opacities, cell UVs -----------
  const drift = ((frame / fps) * DRIFT_SPEED) % TUNNEL_DEPTH;

  const { positions, scales, opacities, cellU, cellV } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const scales = new Float32Array(PARTICLE_COUNT);
    const opacities = new Float32Array(PARTICLE_COUNT);
    const cellU = new Float32Array(PARTICLE_COUNT);
    const cellV = new Float32Array(PARTICLE_COUNT);

    // convergence progress 0..1 across phase 2
    const converge =
      frame < phase2Start
        ? 0
        : frame > phase2End
          ? 1
          : interpolate(frame, [phase2Start, phase2End], [0, 1], {
              easing: Easing.inOut(Easing.cubic),
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });

    // fade out during convergence (1 → 0 across phase 2)
    const fade =
      frame < phase2Start
        ? 1
        : frame > phase2End
          ? 0
          : interpolate(frame, [phase2Start, phase2End], [1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const s = seeds[i];

      // phase-1 wrapped z
      let z = s.z0 + drift;
      while (z > NEAR_Z) z -= TUNNEL_DEPTH;

      let x = Math.cos(s.angle) * s.radius;
      let y = Math.sin(s.angle) * s.radius;

      // phase-2: converge x,y → 0 and pull z to a near display plane
      const targetZ = -10;
      x = x * (1 - converge);
      y = y * (1 - converge);
      z = THREE.MathUtils.lerp(z, targetZ, converge);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // scale grows during convergence (gathering into the title)
      scales[i] = s.scale * (1 + converge * 0.4);

      // opacity: full in phase 1, fade in phase 2
      opacities[i] = fade;

      // atlas cell UV origin = (wordIndex / cols, colorIndex / rows)
      const wordIdx = CODE_WORDS.indexOf(s.word);
      cellU[i] = wordIdx / atlas.cols;
      cellV[i] = s.colorIdx / atlas.rows;
    }
    return { positions, scales, opacities, cellU, cellV };
  }, [frame, fps, seeds, atlas, drift]);

  void durationInFrames;

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={PARTICLE_COUNT} />
        <bufferAttribute attach="attributes-aScale" args={[scales, 1]} count={PARTICLE_COUNT} />
        <bufferAttribute attach="attributes-aOpacity" args={[opacities, 1]} count={PARTICLE_COUNT} />
        <bufferAttribute attach="attributes-aCellU" args={[cellU, 1]} count={PARTICLE_COUNT} />
        <bufferAttribute attach="attributes-aCellV" args={[cellV, 1]} count={PARTICLE_COUNT} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};
