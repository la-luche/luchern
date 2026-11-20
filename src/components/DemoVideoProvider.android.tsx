import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useEffect, type ReactNode } from 'react';

/** Android needs a player owned by its view, rather than the iOS preloaded cache. */
export function DemoVideoProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useDemoVideoPlayer(source: number | undefined, viewReady = true): VideoPlayer | null {
  const player = useVideoPlayer(null, (video) => {
    video.loop = true;
    video.muted = true;
    video.keepScreenOnWhilePlaying = false;
  });
  // Android can report a first frame while its TextureView is still being laid
  // out, leaving a black surface. Prepare only after the view's layout event.
  useEffect(() => {
    if (source == null || !viewReady) return;
    player.replace(source);
  }, [player, source, viewReady]);
  return source == null ? null : player;
}
