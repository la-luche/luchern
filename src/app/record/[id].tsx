import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
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
 * static framing guide helps the patient stay in frame, and start/end haptic
 * cues confirm the capture transitions.
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
      // Omit side metadata so the backend can infer the evaluated side.
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
          {(phase === 'framing' || recording) && <FramingGuide />}

          {/* Overlay chrome. box-none so the preview shows through. */}
          <SafeAreaView className="absolute inset-0" pointerEvents="box-none">
            {/* Top bar. */}
            <View className="min-h-[60px] flex-row items-center justify-between px-4">
              {!recording ? (
                <Pressable
                  onPress={() => router.back()}
                  accessibilityRole="button"
                  accessibilityLabel={t.common.back}
                  className="h-14 w-14 items-center justify-center rounded-full bg-black/50 active:opacity-70"
                >
                  <Ionicons name="chevron-back" size={28} color={COLORS.white} />
                </Pressable>
              ) : (
                <View className="min-h-[48px] flex-row items-center gap-2 rounded-full bg-black/50 px-4 py-2">
                  <View className="h-3 w-3 rounded-full bg-red-500" />
                  <Text className="text-[17px] font-semibold text-white">{formatElapsed(elapsed)}</Text>
                </View>
              )}
              <View className="flex-row items-center gap-2">
                {phase === 'framing' && facing === 'back' && (
                  <Pressable
                    onPress={() => setTorch((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={t.record.flashlight}
                    className="h-14 w-14 items-center justify-center rounded-full bg-black/50 active:opacity-70"
                  >
                    <Ionicons name={torch ? 'flash' : 'flash-off'} size={25} color={COLORS.white} />
                  </Pressable>
                )}
                {phase === 'framing' && (
                  <Pressable
                    onPress={flip}
                    accessibilityRole="button"
                    accessibilityLabel={t.record.flipCamera}
                    className="h-14 w-14 items-center justify-center rounded-full bg-black/50 active:opacity-70"
                  >
                    <Ionicons name="camera-reverse-outline" size={27} color={COLORS.white} />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Test name and framing hint get their own rows, so they cannot
                collide with the back/camera controls on narrow phones. */}
            <View pointerEvents="none" className="mt-3 items-center gap-2 px-5">
              <View className="max-w-full rounded-full bg-black/55 px-4 py-2">
                <Text className="text-center text-[17px] font-semibold text-white">
                  {t.tests[test.id].name}
                </Text>
              </View>
              <View className="max-w-full rounded-2xl bg-black/55 px-4 py-2">
                <Text className="text-center text-[15px] font-semibold leading-5 text-white">
                  {t.tests[test.id].frameHint}
                </Text>
              </View>
            </View>

            <View className="flex-1" pointerEvents="none" />

            {/* Bottom control — Start / End (hidden during review). */}
            {(phase === 'framing' || recording) && (
              <View className="items-center px-4 pb-4">
                <View className="flex-row items-center justify-center gap-6">
                  {phase === 'framing' && (
                    <Pressable
                      onPress={() => stepZoom(-0.1)}
                      accessibilityRole="button"
                      accessibilityLabel={t.record.zoomOut}
                      className="h-16 w-16 items-center justify-center rounded-full bg-black/55 active:opacity-70"
                    >
                      <Ionicons name="remove" size={32} color={COLORS.white} />
                    </Pressable>
                  )}
                  {!recording ? (
                  <Pressable
                    onPress={() => void beginRecording()}
                    disabled={!cameraReady}
                    accessibilityRole="button"
                    accessibilityLabel={t.record.startA11y}
                    className={`h-24 w-24 items-center justify-center rounded-full border-4 border-white/80 bg-white active:opacity-80 ${
                      cameraReady ? '' : 'opacity-40'
                    }`}
                  >
                    <View className="h-9 w-9 rounded-xl bg-red-500" />
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={endRecording}
                    accessibilityRole="button"
                    accessibilityLabel={t.record.endA11y}
                    className="h-24 w-24 items-center justify-center rounded-full border-4 border-white/80 bg-white active:opacity-80"
                  >
                    <View className="h-10 w-10 rounded-xl bg-ink" />
                  </Pressable>
                )}
                  {phase === 'framing' && (
                    <Pressable
                      onPress={() => stepZoom(0.1)}
                      accessibilityRole="button"
                      accessibilityLabel={t.record.zoomIn}
                      className="h-16 w-16 items-center justify-center rounded-full bg-black/55 active:opacity-70"
                    >
                      <Ionicons name="add" size={32} color={COLORS.white} />
                    </Pressable>
                  )}
                </View>
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
  );
}
