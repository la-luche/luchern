import * as FileSystem from 'expo-file-system/legacy';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';

import {
  addProgressListener,
  blurVideoAsync,
  type FaceBlurResult,
} from '../../modules/face-blur';

const inputUri = `${FileSystem.documentDirectory}deid-test-input.mp4`;
const outputUri = `${FileSystem.documentDirectory}deid-test-output.mp4`;
const reportUri = `${FileSystem.documentDirectory}deid-test-report.json`;

function OutputVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.play();
  });

  return <VideoView player={player} nativeControls contentFit="contain" style={{ height: 430 }} />;
}

export function DeidTestHarness() {
  const [status, setStatus] = useState('Waiting to start');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<FaceBlurResult | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setProgress(0);
    setResult(null);
    setVideoUri(null);

    const input = await FileSystem.getInfoAsync(inputUri);
    if (!input.exists) {
      setStatus('Waiting for Documents/deid-test-input.mp4');
      setRunning(false);
      return;
    }

    await FileSystem.deleteAsync(outputUri, { idempotent: true });
    await FileSystem.deleteAsync(reportUri, { idempotent: true });
    const operationId = `deid-device-test-${Date.now()}`;
    const subscription = addProgressListener((event) => {
      if (event.operationId === operationId) setProgress(event.progress);
    });

    try {
      setStatus('Processing on this iPhone');
      const startedAt = Date.now();
      const next = await blurVideoAsync(inputUri, outputUri, operationId, {
        blurFaces: true,
        blurBackground: true,
      });
      const report = {
        source: 'arising-from-chair--trial-211.mp4',
        deviceTest: true,
        elapsedMs: Date.now() - startedAt,
        ...next,
      };
      await FileSystem.writeAsStringAsync(reportUri, `${JSON.stringify(report, null, 2)}\n`);
      setResult(next);
      setVideoUri(outputUri);
      setProgress(1);
      setStatus('Completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await FileSystem.writeAsStringAsync(
        reportUri,
        `${JSON.stringify({ source: 'arising-from-chair--trial-211.mp4', error: message }, null, 2)}\n`,
      ).catch(() => {});
      setStatus(`Failed: ${message}`);
    } finally {
      subscription.remove();
      setRunning(false);
    }
  }, [running]);

  useEffect(() => {
    void run();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Text style={{ fontSize: 24, fontWeight: '700' }}>Luche de-identification device test</Text>
        <Text accessibilityLabel="deid-test-status" style={{ fontSize: 16 }}>{status}</Text>
        <Text style={{ fontSize: 15 }}>Progress: {Math.round(progress * 100)}%</Text>
        {running && <ActivityIndicator />}
        {result && (
          <View style={{ gap: 4 }}>
            <Text>Frames: {result.framesProcessed}</Text>
            <Text>Pose samples: {result.poseSamples}/{result.totalPoseSamples}</Text>
            <Text>Face samples: {result.faceSamples}</Text>
            <Text>Frames with faces: {result.framesWithFaces}</Text>
            <Text>Frames with background blur: {result.framesWithBackgroundBlur}</Text>
            <Text>Detector: {result.detectorMode}</Text>
          </View>
        )}
        {videoUri && <OutputVideo uri={videoUri} />}
        {!running && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Run de-identification test"
            onPress={() => void run()}
            style={{ backgroundColor: '#000c27', borderRadius: 14, padding: 16 }}
          >
            <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>Run again</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
