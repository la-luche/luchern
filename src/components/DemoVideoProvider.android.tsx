import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import type { ReactNode } from 'react';

/** Android needs a player owned by its view, rather than the iOS preloaded cache. */
export function DemoVideoProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useDemoVideoPlayer(source: number | undefined): VideoPlayer | null {
  const player = useVideoPlayer(source ?? null, (video) => {
    video.loop = true;
    video.muted = true;
    video.keepScreenOnWhilePlaying = false;
  });
  return source == null ? null : player;
}
