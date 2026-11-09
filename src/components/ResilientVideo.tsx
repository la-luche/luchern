import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef } from 'react';

import { recordDiagnostic } from '../lib/diagnostics';
import { recoverConnection } from '../lib/networkRecovery';

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
    let disposed = false;
    failed.current = false;
    let ready = player.status === 'readyToPlay';
    if (ready) onReady?.();

    const fail = async (message: string, timedOut = false) => {
      if (failed.current) return;
      failed.current = true;
      recordDiagnostic('video_playback_error', { message });
      if (timedOut || /network|connection|timed? ?out|NSURLErrorDomain/i.test(message)) {
        await recoverConnection(uri);
      }
      if (!disposed) onError();
    };
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        ready = true;
        onReady?.();
      } else if (status === 'error') {
        void fail(error?.message ?? 'video player error');
      }
    });
    const timer = setTimeout(() => {
      if (!ready) void fail('video metadata timed out', true);
    }, VIDEO_METADATA_TIMEOUT_MS);

    return () => {
      disposed = true;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [onError, onReady, player, uri]);

  return <VideoView player={player} style={{ flex: 1 }} nativeControls contentFit="contain" />;
}
