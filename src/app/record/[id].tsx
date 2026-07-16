import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  CameraView,
  CameraType,
  useCameraPermissions,
} from 'expo-camera';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { useT } from '../../lib/i18n';
import { diagnosticErrorData, recordDiagnostic } from '../../lib/diagnostics';
import { useRecordings } from '../../lib/storage';
import { getTest } from '../../lib/tests';
import { COLORS } from '../../lib/theme';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Recording screen: live camera + Start/End. On End the clip is moved into
 *  durable storage, handed to the cloud pipeline, and opened as a result card. */
export default function RecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const test = getTest(id);
  const t = useT();

  const [camPerm, requestCam] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const { addRecording } = useRecordings();

  const [isRecording, setIsRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [facing, setFacing] = useState<CameraType>('back');
  const [zoom, setZoom] = useState(0);
  const zoomBase = useRef(0);

  // Recording timer.
  useEffect(() => {
    if (!isRecording) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording]);

  if (!test) return <Redirect href="/" />;

  const permissionsGranted = camPerm?.granted;

  const startRecording = async () => {
    if (!cameraRef.current || !cameraReady) return;
    setIsRecording(true);
    try {
      // recordAsync resolves only once stopRecording() is called.
      // codec must be set on iOS for the videoBitrate cap (below) to apply.
      const video = await cameraRef.current.recordAsync({ codec: 'hvc1' });
      setIsRecording(false);
      if (!video?.uri) throw new Error('camera returned no recording');
      setSaving(true);
      const rec = await addRecording(test.id, video.uri);
      router.replace({ pathname: '/results/[id]', params: { id: rec.id } });
    } catch (error) {
      setIsRecording(false);
      setSaving(false);
      recordDiagnostic('recording_failed', {
        testId: test.id,
        ...diagnosticErrorData(error),
      });
      Alert.alert(t.record.recordingFailedTitle, t.record.recordingFailedBody);
    }
  };

  const stopRecording = () => {
    cameraRef.current?.stopRecording();
  };

  // Pinch-to-zoom. Disabled while recording so zoom is frozen for the clip.
  // runOnJS(true) lets the callbacks call React setState directly.
  const pinch = Gesture.Pinch()
    .enabled(!isRecording)
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

  // --- Camera --------------------------------------------------------------------
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={pinch}>
        <View className="flex-1 bg-black">
      {/* No audio (mute), 720p, and a 3 Mbps HEVC cap. The keypoint model only
          sees ~768px so higher res/bitrate is wasted upload; 3 Mbps HEVC keeps
          keypoint quality (old app tracked fine at 2 Mbps H.264). NB: videoQuality
          presets are Android-only in expo-camera — on iOS use "4:3" (640x480) if
          720p isn't honored; the bitrate cap applies on iOS via the recordAsync codec. */}
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        mode="video"
        facing={facing}
        zoom={zoom}
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

      {/* Overlay chrome. pointerEvents box-none so the preview shows through. */}
      <SafeAreaView className="absolute inset-0" pointerEvents="box-none">
        {/* Top bar. */}
        <View className="h-12 flex-row items-center justify-between px-[18px]">
          {!isRecording ? (
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
              <Text className="text-[15px] font-semibold text-white">
                {formatElapsed(elapsed)}
              </Text>
            </View>
          )}
          <View className="flex-row items-center gap-2">
            {!isRecording && (
              <Pressable
                onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
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

        <View className="flex-1 items-center justify-end pb-4" pointerEvents="none">
          {!isRecording && zoom === 0 && (
            <View className="rounded-full bg-black/40 px-3 py-1.5">
              <Text className="text-[15px] font-medium text-white/80">{t.record.pinchToZoom}</Text>
            </View>
          )}
        </View>

        {/* Bottom control — Start / End. */}
        <View className="items-center pb-8">
          {saving ? (
            <Text className="text-[15px] font-semibold text-white">{t.record.saving}</Text>
          ) : !isRecording ? (
            <Pressable
              onPress={startRecording}
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
              onPress={stopRecording}
              accessibilityRole="button"
              accessibilityLabel={t.record.endA11y}
              className="h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white/80 bg-white active:opacity-80"
            >
              <View className="h-7 w-7 rounded-lg bg-ink" />
            </Pressable>
          )}
          <Text className="mt-3 text-[16px] font-medium text-white/90">
            {isRecording ? t.record.tapToEnd : cameraReady ? t.record.tapToStart : t.record.preparing}
          </Text>
        </View>
      </SafeAreaView>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
