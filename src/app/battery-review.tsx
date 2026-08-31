import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { createVideoPlayer, useVideoPlayer, VideoView, type VideoThumbnail } from 'expo-video';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
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

function Thumbnail({ uri, onPress }: { uri: string; onPress: () => void }) {
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);

  useEffect(() => {
    let mounted = true;
    const player = createVideoPlayer({ uri });
    void player
      .generateThumbnailsAsync(0, { maxWidth: 360, maxHeight: 240 })
      .then(([image]) => {
        if (mounted && image) setThumbnail(image);
      })
      .catch(() => {})
      .finally(() => player.release());
    return () => {
      mounted = false;
    };
  }, [uri]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="h-24 w-32 overflow-hidden rounded-xl bg-black active:opacity-80"
    >
      {thumbnail ? (
        <Image source={thumbnail} style={{ width: '100%', height: '100%' }} contentFit="cover" />
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
        <SafeAreaView className="flex-1">
          <View className="h-16 items-end justify-center px-4">
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              className="h-12 w-12 items-center justify-center rounded-full bg-white/15"
            >
              <Ionicons name="close" size={28} color="white" />
            </Pressable>
          </View>
          <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
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
    if (!complete || sending) return;
    setSending(true);
    try {
      for (const { recording } of ordered) {
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
                className={`flex-row items-center gap-4 px-4 py-4 ${index > 0 ? 'border-t border-black/5' : ''}`}
              >
                {recording?.videoUri ? (
                  <Thumbnail uri={recording.videoUri} onPress={() => setPreviewUri(recording.videoUri!)} />
                ) : (
                  <View className="h-24 w-32 items-center justify-center rounded-xl bg-white">
                    <Ionicons name="videocam-outline" size={28} color={COLORS.inkMuted} />
                  </View>
                )}

                <View className="flex-1">
                  <Text className="text-[16px] font-semibold text-ink">{t.tests[step.testId].name}</Text>
                  {side ? <Text className="mt-0.5 text-[14px] text-ink-muted">{side}</Text> : null}
                  <Text className="mt-1 text-[13px] text-ink-muted">
                    {recording ? t.batteryReview.recorded : t.batteryReview.missing}
                  </Text>
                  <Pressable
                    onPress={() => recording ? rerecord(step, recording) : openStep(step)}
                    accessibilityRole="button"
                    className="mt-2 self-start py-1 active:opacity-60"
                  >
                    <Text className="text-[15px] font-semibold text-ink underline">
                      {recording ? t.batteryReview.rerecord : t.batteryReview.record}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 border-t border-black/5 bg-white px-6 pb-3 pt-3">
        <Button
          title={sending ? t.batteryReview.sending : t.batteryReview.sendAll}
          onPress={finish}
          disabled={!complete || sending}
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
