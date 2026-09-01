import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  createVideoPlayer,
  useVideoPlayer,
  VideoView,
  type VideoPlayer,
  type VideoThumbnail,
} from 'expo-video';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { formatEvaluatedSide, useT } from '../lib/i18n';
import { endSession, useSession } from '../lib/session';
import { useRecordings } from '../lib/storage';
import { FULL_TEST_FLOW, getTest, type FullTestStep } from '../lib/tests';
import type { Recording } from '../lib/types';
import { COLORS } from '../lib/theme';

function stepKey(step: FullTestStep): string {
  return `${step.testId}:${step.evaluatedSide ?? 'none'}`;
}

function recordingKey(recording: Recording): string {
  return `${recording.testId}:${recording.evaluatedSide ?? 'none'}`;
}

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

function Thumbnail({ uri, onPress }: { uri: string; onPress: () => void }) {
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

function FullScreenPreview({
  uri,
  closeLabel,
  onClose,
}: {
  uri: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.play();
  });

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls
          surfaceType="textureView"
        />
        <SafeAreaView
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 100 }]}
        >
          <View pointerEvents="box-none" className="items-end px-3 pt-6">
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              className="h-16 w-16 items-center justify-center"
            >
              <View className="h-12 w-12 items-center justify-center rounded-full bg-black/70">
                <Ionicons name="close" size={28} color="white" />
              </View>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default function BatteryReviewScreen() {
  const { guestId } = useLocalSearchParams<{ guestId?: string }>();
  const router = useRouter();
  const t = useT();
  const session = useSession();
  const { recordings, finalizeRecording, remove } = useRecordings({ guestId });
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const runId = session.run?.id;
  const runRecordings = useMemo(
    () => recordings.filter((recording) => recording.evaluationRun?.id === runId),
    [recordings, runId],
  );
  const byStep = useMemo(
    () => new Map(runRecordings.map((recording) => [recordingKey(recording), recording])),
    [runRecordings],
  );
  const ordered = FULL_TEST_FLOW.map((step) => ({ step, recording: byStep.get(stepKey(step)) }));
  const complete = ordered.every(({ recording }) => recording?.status === 'draft');
  const sendable = ordered.filter(({ recording }) => recording?.status === 'draft');
  const canSend = sendable.length > 0;

  if (!session.active || !session.run) return <Redirect href="/" />;

  const openStep = (step: FullTestStep) => {
    router.push({
      pathname: '/test/[id]',
      params: {
        id: step.testId,
        batteryReview: '1',
        ...(step.evaluatedSide ? { side: step.evaluatedSide } : {}),
        ...(guestId ? { guestId } : {}),
      },
    });
  };

  const rerecord = (step: FullTestStep, recording: Recording) => {
    Alert.alert(t.batteryReview.warningTitle, t.batteryReview.warningBody, [
      { text: t.batteryReview.keepVideo, style: 'cancel' },
      {
        text: t.batteryReview.discardAndRerecord,
        style: 'destructive',
        onPress: () => {
          void remove(recording.id)
            .then(() => openStep(step))
            .catch(() => Alert.alert(t.batteryReview.sendFailedTitle, t.batteryReview.sendFailedBody));
        },
      },
    ]);
  };

  const finish = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      for (const { recording } of sendable) {
        if (recording) await finalizeRecording(recording.id);
      }
      endSession();
      if (guestId) {
        router.dismissTo({ pathname: '/guests/[id]', params: { id: guestId } });
      } else {
        router.dismissTo('/results');
      }
    } catch {
      setSending(false);
      Alert.alert(t.batteryReview.sendFailedTitle, t.batteryReview.sendFailedBody);
    }
  };

  return (
    <Screen>
      <Header title={t.batteryReview.title} />
      <ScrollView contentContainerClassName="px-5 pb-32">
        <Text className="pb-5 text-[16px] leading-6 text-ink-muted">{t.batteryReview.intro}</Text>

        <View className="overflow-hidden rounded-2xl bg-ink-faint">
          {ordered.map(({ step, recording }, index) => {
            const test = getTest(step.testId)!;
            const side = formatEvaluatedSide(t, test, step.evaluatedSide);
            return (
              <View
                key={stepKey(step)}
                className={`flex-row items-center gap-3 px-4 py-4 ${index > 0 ? 'border-t border-black/5' : ''}`}
              >
                {recording?.videoUri ? (
                  <Thumbnail uri={recording.videoUri} onPress={() => setPreviewUri(recording.videoUri!)} />
                ) : (
                  <View className="h-24 w-28 items-center justify-center rounded-xl bg-white">
                    <Ionicons name="videocam-outline" size={28} color={COLORS.inkMuted} />
                  </View>
                )}

                <View className="min-w-0 flex-1">
                  <Text className="text-[16px] font-semibold text-ink">{t.tests[step.testId].name}</Text>
                  {side ? <Text className="mt-0.5 text-[14px] text-ink-muted">{side}</Text> : null}
                  <Text className="mt-1 text-[13px] text-ink-muted">
                    {recording ? t.batteryReview.recorded : t.batteryReview.missing}
                  </Text>
                </View>

                <Pressable
                  onPress={() => recording ? rerecord(step, recording) : openStep(step)}
                  accessibilityRole="button"
                  className="h-12 min-w-[88px] items-center justify-center rounded-xl bg-ink px-3 active:opacity-70"
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                    className="text-[14px] font-semibold text-white"
                  >
                    {recording ? t.batteryReview.rerecord : t.batteryReview.record}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 border-t border-black/5 bg-white px-6 pb-3 pt-3">
        <Button
          title={
            sending
              ? t.batteryReview.sending
              : complete
                ? t.batteryReview.sendAll
                : t.batteryReview.sendRecorded
          }
          onPress={finish}
          disabled={!canSend || sending}
        />
      </View>

      {previewUri ? (
        <FullScreenPreview
          uri={previewUri}
          closeLabel={t.batteryReview.closeVideo}
          onClose={() => setPreviewUri(null)}
        />
      ) : null}
    </Screen>
  );
}
