import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';

import { recordDiagnostic } from '../lib/diagnostics';

const VIDEO_METADATA_TIMEOUT_MS = 15_000;

/**
 * Native playback is outside fetch/apiFetch, so surface its failures through
 * the same recovery UI instead of leaving a permanent black rectangle.
 * Parents own the single automatic signed-URL refresh budget.
 */
export function ResilientVideo({
  uri,
  onError,
  onReady,
}: {
  uri: string;
  onError: () => void;
  onReady?: () => void;
}) {
  const failed = useRef(false);
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = true;
  });

  useEffect(() => {
    failed.current = false;
    let ready = player.status === 'readyToPlay';
    if (ready) onReady?.();

    const fail = (message: string) => {
      if (failed.current) return;
      failed.current = true;
      recordDiagnostic('video_playback_error', { message });
      onError();
    };
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        ready = true;
        onReady?.();
      } else if (status === 'error') {
        fail(error?.message ?? 'video player error');
      }
    });
    const timer = setTimeout(() => {
      if (!ready) fail('video metadata timed out');
    }, VIDEO_METADATA_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [onError, onReady, player]);

  return <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" />;
}
