import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { TESTS } from '../lib/tests';

const DemoVideoContext = createContext<ReadonlyMap<number, VideoPlayer> | null>(null);

/**
 * App-lifetime cache for the fixed instruction clips.
 *
 * expo-video buffers a player even before it is attached to a VideoView. The
 * demo set is small and bundled with the app, so creating these players once at
 * the root makes every instruction screen ready before the patient taps a test.
 * Uploaded patient recordings use a separate playback path and are not cached
 * here.
 */
export function DemoVideoProvider({ children }: { children: ReactNode }) {
  const [players] = useState(() => {
    const cache = new Map<number, VideoPlayer>();

    for (const test of TESTS) {
      if (test.demoVideo == null || cache.has(test.demoVideo)) continue;

      const player = createVideoPlayer(test.demoVideo);
      player.loop = true;
      player.muted = true;
      player.keepScreenOnWhilePlaying = false;
      cache.set(test.demoVideo, player);
    }

    return cache;
  });

  useEffect(
    () => () => {
      for (const player of players.values()) {
        player.pause();
        player.release();
      }
    },
    [players],
  );

  return <DemoVideoContext.Provider value={players}>{children}</DemoVideoContext.Provider>;
}

/** Returns the already-buffering player for a bundled instruction clip. */
export function useDemoVideoPlayer(source: number | undefined): VideoPlayer | null {
  const players = useContext(DemoVideoContext);
  if (players == null) {
    throw new Error('useDemoVideoPlayer must be used inside DemoVideoProvider');
  }
  return source == null ? null : (players.get(source) ?? null);
}
