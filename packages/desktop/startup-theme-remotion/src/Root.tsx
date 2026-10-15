import React from 'react';
import { Composition } from 'remotion';
import { StartupAnimation } from './StartupAnimation';

/**
 * Animation timeline (30 fps × 8s = 240 frames):
 *
 *   Phase 1  星际穿梭     frames   0–120  (0s–4s)
 *   Phase 2  汇聚过渡     frames 120–180  (4s–6s)
 *   Phase 3  就绪展示     frames 180–240  (6s–8s)
 *
 * Master dimensions 1920×1080 (16:9); the Corum startup video theme player
 * scales to fit the startup window while preserving aspect ratio.
 */
const FPS = 30;
const DURATION = 240;
const WIDTH = 1920;
const HEIGHT = 1080;

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="CorumStartup"
        component={StartupAnimation}
        durationInFrames={DURATION}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{}}
      />
    </>
  );
};
