import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { FramingGuide, ReviewPanel } from '../../components/Capture';
import { Screen } from '../../components/Screen';
import { cues } from '../../lib/cues';
import { useT } from '../../lib/i18n';
import { diagnosticErrorData, recordDiagnostic } from '../../lib/diagnostics';
import { advanceSession, endSession, useSession } from '../../lib/session';
import { useRecordings } from '../../lib/storage';
import { showToast } from '../../lib/toast';
import { getTest } from '../../lib/tests';
import { COLORS } from '../../lib/theme';

type Phase = 'framing' | 'recording' | 'review';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Capture screen as a small state machine:
 *   framing → (Start) → recording → (End) → review → (Submit) → result
 * The clip is held locally and only uploaded on Submit; Retake discards it. A
 * static framing guide helps the patient stay in frame, and start/end audio +
 * haptic cues make it usable without watching the screen.
 */
export default function RecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const test = getTest(id);
  const t = useT();

  const [camPerm, requestCam] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const { addRecording } = useRecordings();
  const session = useSession();
  useKeepAwake(); // keep the screen on while filming a test

  const [phase, setPhase] = useState<Phase>('framing');
  const [submitting, setSubmitting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);
  const zoomBase = useRef(0);

  // Pending clip awaiting review. Refs mirror it so the unmount cleanup can
  // delete an un-submitted temp file without capturing stale state.
  const [tempUri, setTempUri] = useState<string | null>(null);
  const tempUriRef = useRef<string | null>(null);
  const submittedRef = useRef(false);
  const setTemp = (uri: string | null) => {
    tempUriRef.current = uri;
    setTempUri(uri);
  };

  // Recording timer.
  useEffect(() => {
    if (phase !== 'recording') {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Best-effort cleanup: if we leave with an un-submitted clip, delete it.
  useEffect(
    () => () => {
      if (tempUriRef.current && !submittedRef.current) {
        FileSystem.deleteAsync(tempUriRef.current, { idempotent: true }).catch(() => {});
      }
    },
    [],
  );

  if (!test) return <Redirect href="/" />;

  const permissionsGranted = camPerm?.granted;

  const beginRecording = async () => {
    if (!cameraRef.current || !cameraReady) {
      setPhase('framing');
      return;
    }
    setPhase('recording');
    cues.start(t.tests[test.id].cueStart);
    try {
      // recordAsync resolves only once stopRecording() is called.
      // codec must be set on iOS for the videoBitrate cap (below) to apply.
      const video = await cameraRef.current.recordAsync({ codec: 'hvc1' });
      if (!video?.uri) throw new Error('camera returned no recording');
      setTemp(video.uri);
      setPhase('review');
    } catch (error) {
      setPhase('framing');
      recordDiagnostic('recording_failed', { testId: test.id, ...diagnosticErrorData(error) });
      Alert.alert(t.record.recordingFailedTitle, t.record.recordingFailedBody);
    }
  };

  const endRecording = () => {
    cues.stop(t.record.cueDone);
    cameraRef.current?.stopRecording();
  };

  const submitClip = async () => {
    if (!tempUri || submitting) return;
    setSubmitting(true);
    try {
      const rec = await addRecording(test.id, tempUri);
      submittedRef.current = true; // storage now owns the file — don't clean it up
      cues.saved();
      showToast(t.toast.saved);
      if (session.active) {
        // Guided session: advance to the next test (or finish). A failed upload
        // doesn't block — the clip is saved and retries in the background.
        const next = advanceSession();
        if (next) {
          router.replace({ pathname: '/test/[id]', params: { id: next } });
        } else {
          endSession();
          router.replace('/results');
        }
      } else {
        router.replace({ pathname: '/results/[id]', params: { id: rec.id } });
      }
    } catch (error) {
      setSubmitting(false);
      recordDiagnostic('recording_failed', { testId: test.id, ...diagnosticErrorData(error) });
      Alert.alert(t.record.recordingFailedTitle, t.record.recordingFailedBody);
    }
  };

  const retakeClip = () => {
    const uri = tempUriRef.current;
    if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    setTemp(null);
    setZoom(0);
    setPhase('framing');
  };

  const flip = () => {
    setFacing((f) => (f === 'back' ? 'front' : 'back'));
    setTorch(false); // torch is a back-camera feature; reset on flip
  };

  const stepZoom = (delta: number) =>
    setZoom((z) => Math.min(1, Math.max(0, Math.round((z + delta) * 100) / 100)));

  // Pinch-to-zoom, only while framing (zoom is frozen for the clip).
  const pinch = Gesture.Pinch()
    .enabled(phase === 'framing')
    .runOnJS(true)
    .onStart(() => {
      zoomBase.current = zoom;
    })
    .onUpdate((e) => {
      const next = Math.min(Math.max(zoomBase.current + (e.scale - 1) * 0.4, 0), 1);
      setZoom(next);
    });

  // --- Permission gate ---------------------------------------------------------
  if (!permissionsGranted) {
    const permanentlyDenied = camPerm && !camPerm.granted && !camPerm.canAskAgain;

    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8">
          <MaterialCommunityIcons name="camera-off-outline" size={56} color={COLORS.ink} />
          <Text className="mt-5 text-center text-[22px] font-bold text-ink">
            {t.record.cameraAccessNeeded}
          </Text>
          <Text className="mt-2 text-center text-[15px] leading-6 text-ink/60">
            {t.record.cameraAccessBody(t.tests[test.id].name)}
          </Text>
          <View className="mt-8 w-full gap-3">
            <Button
              title={permanentlyDenied ? t.record.openSettings : t.record.grantAccess}
              onPress={permanentlyDenied ? () => Linking.openSettings() : requestCam}
            />
            <Button title={t.common.back} variant="secondary" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  const recording = phase === 'recording';

  // --- Camera --------------------------------------------------------------------
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={pinch}>
        <View className="flex-1 bg-black">
          {/* No audio (mute), 720p, and a 3 Mbps HEVC cap. The keypoint model only
              sees ~768px so higher res/bitrate is wasted upload; 3 Mbps HEVC keeps
              keypoint quality. NB: videoQuality presets are Android-only in
              expo-camera; the bitrate cap applies on iOS via the recordAsync codec. */}
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            mode="video"
            facing={facing}
            zoom={zoom}
            enableTorch={torch && facing === 'back'}
            mute
            videoQuality="720p"
            videoBitrate={3000000}
            onCameraReady={() => setCameraReady(true)}
            onMountError={({ message }) => {
              setCameraReady(false);
              recordDiagnostic('camera_mount_failed', { testId: test.id, message });
              Alert.alert(t.record.cameraFailedTitle, t.record.cameraFailedBody);
            }}
          />

          {/* Framing guide during framing + recording (helps stay in frame). */}
          {(phase === 'framing' || recording) && (
            <FramingGuide hint={t.tests[test.id].frameHint} />
          )}

          {/* Overlay chrome. box-none so the preview shows through. */}
          <SafeAreaView className="absolute inset-0" pointerEvents="box-none">
            {/* Top bar. */}
            <View className="h-12 flex-row items-center justify-between px-[18px]">
              {!recording ? (
                <Pressable
                  onPress={() => router.back()}
                  accessibilityRole="button"
                  accessibilityLabel={t.common.back}
                  className="h-11 w-11 items-center justify-center rounded-full bg-black/40 active:opacity-70"
                >
                  <Ionicons name="chevron-back" size={22} color={COLORS.white} />
                </Pressable>
              ) : (
                <View className="flex-row items-center gap-2 rounded-full bg-black/40 px-3 py-1.5">
                  <View className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <Text className="text-[15px] font-semibold text-white">{formatElapsed(elapsed)}</Text>
                </View>
              )}
              <View className="flex-row items-center gap-2">
                {phase === 'framing' && facing === 'back' && (
                  <Pressable
                    onPress={() => setTorch((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={t.record.flashlight}
                    className="h-11 w-11 items-center justify-center rounded-full bg-black/40 active:opacity-70"
                  >
                    <Ionicons name={torch ? 'flash' : 'flash-off'} size={20} color={COLORS.white} />
                  </Pressable>
                )}
                {phase === 'framing' && (
                  <Pressable
                    onPress={flip}
                    accessibilityRole="button"
                    accessibilityLabel={t.record.flipCamera}
                    className="h-11 w-11 items-center justify-center rounded-full bg-black/40 active:opacity-70"
                  >
                    <Ionicons name="camera-reverse-outline" size={22} color={COLORS.white} />
                  </Pressable>
                )}
                <View className="rounded-full bg-black/40 px-3 py-1.5">
                  <Text className="text-[15px] font-semibold text-white">{t.tests[test.id].name}</Text>
                </View>
              </View>
            </View>

            {/* Zoom +/- — tremor-friendly alternative to pinch. */}
            {phase === 'framing' && (
              <View className="absolute right-4 top-1/2 -mt-12 gap-3">
                <Pressable
                  onPress={() => stepZoom(0.1)}
                  accessibilityRole="button"
                  accessibilityLabel={t.record.zoomIn}
                  className="h-11 w-11 items-center justify-center rounded-full bg-black/40 active:opacity-70"
                >
                  <Ionicons name="add" size={24} color={COLORS.white} />
                </Pressable>
                <Pressable
                  onPress={() => stepZoom(-0.1)}
                  accessibilityRole="button"
                  accessibilityLabel={t.record.zoomOut}
                  className="h-11 w-11 items-center justify-center rounded-full bg-black/40 active:opacity-70"
                >
                  <Ionicons name="remove" size={24} color={COLORS.white} />
                </Pressable>
              </View>
            )}

            <View className="flex-1 items-center justify-end pb-4" pointerEvents="none">
              {phase === 'framing' && zoom === 0 && (
                <View className="rounded-full bg-black/40 px-3 py-1.5">
                  <Text className="text-[15px] font-medium text-white/80">{t.record.pinchToZoom}</Text>
                </View>
              )}
            </View>

            {/* Bottom control — Start / End (hidden during review). */}
            {(phase === 'framing' || recording) && (
              <View className="items-center pb-8">
                {!recording ? (
                  <Pressable
                    onPress={() => void beginRecording()}
                    disabled={!cameraReady}
                    accessibilityRole="button"
                    accessibilityLabel={t.record.startA11y}
                    className={`h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white/80 bg-white active:opacity-80 ${
                      cameraReady ? '' : 'opacity-40'
                    }`}
                  >
                    <View className="h-6 w-6 rounded-md bg-red-500" />
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={endRecording}
                    accessibilityRole="button"
                    accessibilityLabel={t.record.endA11y}
                    className="h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white/80 bg-white active:opacity-80"
                  >
                    <View className="h-7 w-7 rounded-lg bg-ink" />
                  </Pressable>
                )}
                <Text className="mt-3 text-[16px] font-medium text-white/90">
                  {recording ? t.record.tapToEnd : cameraReady ? t.record.tapToStart : t.record.preparing}
                </Text>
              </View>
            )}
          </SafeAreaView>

          {/* Review the clip before it uploads. */}
          {phase === 'review' && tempUri && (
            <ReviewPanel
              uri={tempUri}
              title={t.record.reviewTitle}
              hint={t.record.reviewHint}
              submitLabel={t.record.submit}
              retakeLabel={t.record.retake}
              submitting={submitting}
              onSubmit={submitClip}
              onRetake={retakeClip}
            />
          )}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
