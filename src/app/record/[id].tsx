import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { useUser } from '@clerk/clerk-expo';
import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { Button } from '../../components/Button';
import { ReviewPanel } from '../../components/Capture';
import { RecordingOverlay } from '../../components/RecordingOverlay';
import { Screen } from '../../components/Screen';
import { preferredRearCameraLens } from '../../lib/cameraLens';
import { cues } from '../../lib/cues';
import { setCaptureActive } from '../../lib/captureActivity';
import {
  attachCaptureOutput,
  beginCaptureIntent,
  clearCaptureIntent,
} from '../../lib/captureRecovery';
import { formatEvaluatedSide, useT } from '../../lib/i18n';
import { diagnosticErrorData, recordDiagnostic } from '../../lib/diagnostics';
import { ensureFreeRecordingSpace } from '../../lib/recordingFiles';
import { recordingMaxDuration } from '../../lib/recordingGuide';
import { advanceSession, useSession } from '../../lib/session';
import { useRecordings } from '../../lib/storage';
import { showToast } from '../../lib/toast';
import { getTest, type EvaluatedSide } from '../../lib/tests';
import { COLORS } from '../../lib/theme';

type Phase = 'framing' | 'recording' | 'review';

/**
 * Capture screen as a small state machine:
 *   framing → (Start) → recording → (End) → review → (Submit) → result
 * The clip is held locally and only uploaded on Submit; Retake discards it. A
 * static movement guide shows the requested pose, and start/end haptic
 * cues confirm the capture transitions.
 */
export default function RecordScreen() {
  const { id, guestId, side, batteryReview } = useLocalSearchParams<{
    id: string;
    guestId?: string;
    side?: string;
    batteryReview?: string;
  }>();
  const router = useRouter();
  const { user } = useUser();
  const test = getTest(id);
  const t = useT();

  const [camPerm, requestCam, refreshCam] = useCameraPermissions();
  const requestedCamera = useRef(false);
  const [cameraPermissionError, setCameraPermissionError] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const { stageRecording, finalizeRecording, remove } = useRecordings();
  const session = useSession();
  useKeepAwake(); // keep the screen on while filming a test

  useEffect(() => {
    setCaptureActive(true);
    return () => setCaptureActive(false);
  }, []);

  const [phase, setPhase] = useState<Phase>('framing');
  const [submitting, setSubmitting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(false);
  const stopCuePlayed = useRef(false);
  const [zoom, setZoom] = useState(0);

  // Opening the recording feature leads directly to the system permission
  // dialog. Never show a custom consent screen or automatically retry a denial.
  useEffect(() => {
    if (
      !test || camPerm?.status !== 'undetermined' || !camPerm.canAskAgain || requestedCamera.current
    ) return;
    requestedCamera.current = true;
    void requestCam().catch(() => setCameraPermissionError(true));
  }, [camPerm, requestCam, test]);

  // Pick up changes made in Settings without requiring the user to reopen
  // the recording screen. Reading permission never opens another prompt.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void refreshCam().catch(() => setCameraPermissionError(true));
      }
    });
    return () => subscription.remove();
  }, [refreshCam]);

  // The clip is durably staged before review. Retake is the only path that
  // deletes it; navigation, jetsam, or a dead battery leave it recoverable.
  const [tempUri, setTempUri] = useState<string | null>(null);
  const [stagedRecordingId, setStagedRecordingId] = useState<string | null>(null);

  // Recording timer.
  useEffect(() => {
    if (phase !== 'recording') {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && phase === 'recording') cameraRef.current?.stopRecording();
    });
    const memorySubscription = AppState.addEventListener('memoryWarning', () => {
      if (phase === 'recording') cameraRef.current?.stopRecording();
    });
    return () => {
      subscription.remove();
      memorySubscription.remove();
    };
  }, [phase]);

  if (!test) return <Redirect href="/" />;

  const permissionsGranted = camPerm?.granted;
  const routeSide: EvaluatedSide | undefined =
    side === 'left' || side === 'right' ? side : undefined;
  const sessionSide =
    session.active && session.current?.testId === test.id
      ? session.current.evaluatedSide
      : undefined;
  const evaluatedSide = test.sideSpecific ? (routeSide ?? sessionSide) : undefined;
  const sideLabel = formatEvaluatedSide(t, test, evaluatedSide);

  const beginRecording = async () => {
    if (!cameraRef.current || !cameraReady) {
      setPhase('framing');
      return;
    }
    let outputReceived = false;
    try {
      await ensureFreeRecordingSpace();
      if (!user?.id) throw new Error('recording account unavailable');
      const evaluationRun = session.active ? session.run ?? undefined : undefined;
      await beginCaptureIntent(user.id, { testId: test.id, evaluatedSide, guestId, evaluationRun });
      stopCuePlayed.current = false;
      setPhase('recording');
      cues.start(t.tests[test.id].cueStart);
      // Timed tasks finish at their target; repetition tasks stop manually.
      // codec must be set on iOS for the videoBitrate cap (below) to apply.
      const video = await cameraRef.current.recordAsync({
        codec: 'hvc1',
        maxDuration: recordingMaxDuration(test.id),
        maxFileSize: 64 * 1024 * 1024,
      });
      if (!video?.uri) throw new Error('camera returned no recording');
      if (!stopCuePlayed.current) {
        stopCuePlayed.current = true;
        cues.stop(t.record.cueDone);
      }
      outputReceived = true;
      await attachCaptureOutput(user.id, video.uri);
      const staged = await stageRecording(
        test.id,
        video.uri,
        evaluatedSide,
        guestId,
        evaluationRun,
      );
      if (!staged.videoUri) throw new Error('saved recording is unavailable');
      setStagedRecordingId(staged.id);
      setTempUri(staged.videoUri);
      setPhase('review');
    } catch (error) {
      if (!outputReceived && user?.id) await clearCaptureIntent(user.id).catch(() => {});
      setPhase('framing');
      recordDiagnostic('recording_failed', { testId: test.id, ...diagnosticErrorData(error) });
      Alert.alert(t.record.recordingFailedTitle, t.record.recordingFailedBody);
    }
  };

  const endRecording = () => {
    if (!stopCuePlayed.current) {
      stopCuePlayed.current = true;
      cues.stop(t.record.cueDone);
    }
    cameraRef.current?.stopRecording();
  };

  const submitClip = async () => {
    if (!stagedRecordingId || submitting) return;
    setSubmitting(true);
    try {
      cues.saved();
      showToast(t.toast.saved);
      if (session.active) {
        // Guided batteries stay as local drafts until the final review screen.
        if (batteryReview === '1') {
          router.dismissTo({
            pathname: '/battery-review',
            params: { ...(guestId ? { guestId } : {}) },
          });
          return;
        }
        const next = advanceSession();
        if (next) {
          router.replace({
            pathname: '/test/[id]',
            params: { id: next.testId, ...(guestId ? { guestId } : {}) },
          });
        } else {
          router.replace({
            pathname: '/battery-review',
            params: { ...(guestId ? { guestId } : {}) },
          });
        }
      } else {
        const rec = await finalizeRecording(stagedRecordingId);
        router.replace({
          pathname: '/results/[id]',
          params: {
            id: rec.id,
            singleTestComplete: '1',
            ...(guestId ? { guestId } : {}),
          },
        });
      }
    } catch (error) {
      setSubmitting(false);
      recordDiagnostic('recording_failed', { testId: test.id, ...diagnosticErrorData(error) });
      Alert.alert(t.record.recordingFailedTitle, t.record.recordingFailedBody);
    }
  };

  const retakeClip = async () => {
    if (stagedRecordingId) await remove(stagedRecordingId);
    setStagedRecordingId(null);
    setTempUri(null);
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
  if (
    !cameraPermissionError &&
    (!camPerm || (camPerm.status === 'undetermined' && camPerm.canAskAgain))
  ) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={COLORS.ink} accessibilityLabel={t.record.preparing} />
        </View>
      </Screen>
    );
  }

  if (!permissionsGranted) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center px-8">
          <MaterialCommunityIcons name="camera-off-outline" size={56} color={COLORS.ink} />
          <Text className="mt-5 text-center text-[22px] font-bold text-ink">
            {cameraPermissionError ? t.record.cameraFailedTitle : t.record.cameraAccessNeeded}
          </Text>
          <Text className="mt-2 text-center text-[15px] leading-6 text-ink/60">
            {cameraPermissionError
              ? t.record.cameraFailedBody
              : t.record.cameraAccessBody(t.tests[test.id].name)}
          </Text>
          <View className="mt-8 w-full gap-3">
            {!cameraPermissionError && (
              <Button title={t.record.openSettings} onPress={() => Linking.openSettings()} />
            )}
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
          <StatusBar style="light" />
          {/* No audio (mute), 720p, and a 3 Mbps HEVC cap. The keypoint model only
              sees ~768px so higher res/bitrate is wasted upload; 3 Mbps HEVC keeps
              keypoint quality. NB: videoQuality presets are Android-only in
              expo-camera; the bitrate cap applies on iOS via the recordAsync codec. */}
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            mode="video"
            active={phase !== 'review'}
            facing={facing}
            zoom={zoom}
            selectedLens={
              Platform.OS === 'ios' && facing === 'back'
                ? preferredRearCameraLens(test.id)
                : undefined
            }
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

          {(phase === 'framing' || recording) && (
            <RecordingOverlay
              testId={test.id}
              t={t}
              side={evaluatedSide}
              sideLabel={sideLabel}
              recording={recording}
              elapsed={elapsed}
              cameraReady={cameraReady}
              facing={facing}
              torch={torch}
              zoom={zoom}
              onBack={() => router.back()}
              onFlash={() => setTorch((value) => !value)}
              onFlip={flip}
              onZoom={stepZoom}
              onStart={() => void beginRecording()}
              onStop={endRecording}
            />
          )}

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
