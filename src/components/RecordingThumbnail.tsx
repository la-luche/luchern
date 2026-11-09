import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { createVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

// Expo Video's iOS bridge currently asserts if thumbnail generation receives a
// scalar timestamp, despite the TypeScript API permitting one. Keep the native
// calls serialized as well so opening a 13-video review does not spin up 13
// decoders at once.
let thumbnailQueue: Promise<void> = Promise.resolve();
const THUMBNAIL_TIMEOUT_MS = 8_000;

function waitForPlayerReady(player: VideoPlayer): Promise<void> {
  if (player.status === 'readyToPlay') return Promise.resolve();
  if (player.status === 'error') return Promise.reject(new Error('video failed to load'));

  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: { remove(): void } | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.remove();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error('video thumbnail load timed out')),
      THUMBNAIL_TIMEOUT_MS,
    );
    subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') finish();
      if (status === 'error') finish(new Error('video failed to load'));
    });
    if (player.status === 'readyToPlay') finish();
    if (player.status === 'error') finish(new Error('video failed to load'));
  });
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('video thumbnail generation timed out')),
      THUMBNAIL_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function generateThumbnail(
  uri: string,
  shouldGenerate: () => boolean,
): Promise<VideoThumbnail | null> {
  const task = thumbnailQueue.then(async () => {
    if (!shouldGenerate()) return null;
    const player = createVideoPlayer({ uri });
    try {
      await waitForPlayerReady(player);
      if (!shouldGenerate()) return null;
      const middle = Number.isFinite(player.duration) ? Math.max(0, player.duration / 2) : 0;
      const [image] = await withTimeout(
        player.generateThumbnailsAsync([middle], {
          maxWidth: 360,
          maxHeight: 240,
        }),
      );
      return image ?? null;
    } finally {
      player.release();
    }
  });
  thumbnailQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export function RecordingThumbnail({ uri, onPress }: { uri: string; onPress: () => void }) {
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    setThumbnail(null);
    setFailed(false);
    void generateThumbnail(uri, () => mounted)
      .then((image) => {
        if (!mounted) return;
        if (image) setThumbnail(image);
        else setFailed(true);
      })
      .catch(() => {
        if (mounted) setFailed(true);
      });
    return () => {
      mounted = false;
    };
  }, [uri]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="h-24 w-28 overflow-hidden rounded-xl bg-black active:opacity-80"
    >
      {thumbnail ? (
        <Image source={thumbnail} style={{ width: '100%', height: '100%' }} contentFit="cover" />
      ) : failed ? (
        <View className="flex-1 items-center justify-center">
          <Ionicons name="videocam-outline" size={28} color="white" />
        </View>
      ) : (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="white" />
        </View>
      )}
      <View className="absolute inset-0 items-center justify-center bg-black/15">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-black/60">
          <Ionicons name="play" size={20} color="white" />
        </View>
      </View>
    </Pressable>
  );
}

