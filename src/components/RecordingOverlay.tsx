import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Dict } from '../lib/i18n/en';
import { RECORDING_GUIDES, RECORDING_TARGETS, recordingTargetCount } from '../lib/recordingGuide';
import type { EvaluatedSide, TestId } from '../lib/tests';

type Props = {
  testId: TestId;
  t: Dict;
  side?: EvaluatedSide;
  sideLabel?: string;
  recording: boolean;
  elapsed: number;
  cameraReady: boolean;
  facing: 'front' | 'back';
  torch: boolean;
  zoom: number;
  onBack: () => void;
  onFlash: () => void;
  onFlip: () => void;
  onZoom: (delta: number) => void;
  onStart: () => void;
  onStop: () => void;
};

function Emphasis({ text }: { text: string }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**')
      ? <Text key={index} style={styles.emphasis}>{part.slice(2, -2)}</Text>
      : part,
  );
}

/** Local artwork is a screen overlay only: it is never added to the recorded video. */
export function RecordingOverlay(props: Props) {
  const { testId, t, side, sideLabel, recording, elapsed, cameraReady, facing, torch, zoom } = props;
  const { width } = useWindowDimensions();
  const size = Math.min(width / 390, 1.2);
  const copy = t.record.guidance[testId];
  const target = RECORDING_TARGETS[testId];
  const metric = t.record.target[target.unit](recordingTargetCount(testId, recording ? elapsed : 0));

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.artwork}>
        <Image
          testID={`recording-guide-${testId}`}
          source={RECORDING_GUIDES[testId]}
          resizeMode="stretch"
          fadeDuration={0}
          style={[styles.guide, testId === 'restTremor' && styles.restGuide, side === 'left' && styles.mirrored]}
        />
      </View>

      <SafeAreaView pointerEvents="box-none" style={styles.chrome}>
        <View pointerEvents="box-none" style={styles.header}>
          <View pointerEvents="none" style={styles.titleRow}>
            <View style={styles.titleBubble}>
              <Text
                style={[styles.title, { fontSize: 28 * size, lineHeight: 35 * size }]}
                maxFontSizeMultiplier={1.3}
              >{copy.title}</Text>
            </View>
          </View>
          <Pressable
            testID="recording-back"
            onPress={props.onBack}
            disabled={recording}
            accessibilityRole="button"
            accessibilityLabel={t.common.back}
            accessibilityState={{ disabled: recording }}
            className="active:opacity-70"
            style={[styles.round, styles.back, recording && styles.disabled]}
          ><Ionicons name="chevron-back" size={27} color="white" /></Pressable>
          {recording ? (
            <View pointerEvents="none" testID="recording-elapsed" style={[styles.round, styles.elapsedBadge]}>
              <Text style={styles.elapsedText} maxFontSizeMultiplier={1.2}>
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
              </Text>
            </View>
          ) : null}
          <View pointerEvents="none" style={styles.instructionBubble}>
            <Text style={styles.instruction} maxFontSizeMultiplier={1.35}>
              <Emphasis text={copy.instruction} />
            </Text>
          </View>
        </View>

        <View pointerEvents="none" style={styles.space} />

        <View pointerEvents="box-none" style={styles.footer}>
          <View pointerEvents="none" style={styles.statusRow}>
            {sideLabel ? <Text style={styles.statusBadge} maxFontSizeMultiplier={1.3}>{sideLabel}</Text> : null}
          </View>
          <Text
            testID="recording-target"
            pointerEvents="none"
            style={[styles.metric, { fontSize: 59 * size, lineHeight: 68 * size }]}
            adjustsFontSizeToFit
            numberOfLines={1}
            minimumFontScale={0.6}
            maxFontSizeMultiplier={1.2}
          >{metric}</Text>
          <View style={styles.captureRow}>
            <Pressable
              onPress={() => props.onZoom(-0.1)}
              disabled={recording || zoom <= 0}
              accessibilityRole="button"
              accessibilityLabel={t.record.zoomOut}
              accessibilityState={{ disabled: recording || zoom <= 0 }}
              className="active:opacity-70"
              style={[styles.round, styles.zoom, (recording || zoom <= 0) && styles.disabled]}
            ><Ionicons name="remove" size={30} color="white" /></Pressable>
            <Pressable
              testID="recording-control"
              onPress={recording ? props.onStop : props.onStart}
              disabled={!recording && !cameraReady}
              accessibilityRole="button"
              accessibilityLabel={recording ? t.record.endA11y : t.record.startA11y}
              accessibilityState={{ disabled: !recording && !cameraReady }}
              className="active:opacity-70"
              style={[styles.record, !recording && !cameraReady && styles.disabled]}
            ><View pointerEvents="none" style={[styles.recordCore, recording && styles.stopCore]} /></Pressable>
            <Pressable
              onPress={() => props.onZoom(0.1)}
              disabled={recording || zoom >= 1}
              accessibilityRole="button"
              accessibilityLabel={t.record.zoomIn}
              accessibilityState={{ disabled: recording || zoom >= 1 }}
              className="active:opacity-70"
              style={[styles.round, styles.zoom, (recording || zoom >= 1) && styles.disabled]}
            ><Ionicons name="add" size={30} color="white" /></Pressable>
          </View>
          <Text style={styles.captureLabel} maxFontSizeMultiplier={1.3}>
            {recording ? t.record.tapToEnd : cameraReady ? t.record.tapToStart : t.record.preparing}
          </Text>
        </View>
      </SafeAreaView>

      <View pointerEvents="box-none" style={styles.sideControls}>
        <Pressable
          testID="recording-flash"
          onPress={props.onFlash}
          disabled={recording || facing === 'front'}
          accessibilityRole="button"
          accessibilityLabel={t.record.flashlight}
          accessibilityState={{ disabled: recording || facing === 'front', selected: torch }}
          className="active:opacity-70"
          style={[styles.round, torch && styles.flashActive, (recording || facing === 'front') && styles.disabled]}
        ><Ionicons name="flash-outline" size={26} color={torch ? '#fff0a8' : 'white'} /></Pressable>
        <Pressable
          testID="recording-flip"
          onPress={props.onFlip}
          disabled={recording}
          accessibilityRole="button"
          accessibilityLabel={t.record.flipCamera}
          accessibilityState={{ disabled: recording }}
          className="active:opacity-70"
          style={[styles.round, recording && styles.disabled]}
        ><Ionicons name="camera-reverse-outline" size={27} color="white" /></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  artwork: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  // These are complete, approved screen compositions. Cover would zoom and
  // crop them a second time on phones taller than the reference canvas.
  guide: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  restGuide: { left: '-5%' },
  mirrored: { transform: [{ scaleX: -1 }] },
  chrome: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8 },
  titleRow: { alignItems: 'center', minHeight: 56, paddingHorizontal: 60 },
  titleBubble: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 34, backgroundColor: '#1415168c' },
  title: { color: 'white', textAlign: 'center', fontWeight: '600', letterSpacing: 0.42 },
  instructionBubble: { alignSelf: 'center', maxWidth: '96%', marginTop: 13, paddingHorizontal: 21, paddingVertical: 14, borderRadius: 24, backgroundColor: '#1415168c' },
  instruction: { fontSize: 19, lineHeight: 27, fontWeight: '400', color: 'white', textAlign: 'center' },
  emphasis: { fontWeight: '700' },
  round: { width: 52, height: 52, borderRadius: 30, backgroundColor: '#15171680', alignItems: 'center', justifyContent: 'center' },
  back: { position: 'absolute', top: 8, left: 16, width: 44, height: 44 },
  sideControls: { position: 'absolute', top: '43%', right: 16, gap: 12 },
  flashActive: { backgroundColor: '#45442dc9' },
  disabled: { opacity: 0.38 },
  space: { flex: 1 },
  footer: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 30, marginBottom: 5 },
  statusBadge: { color: 'white', fontSize: 14, fontWeight: '600', backgroundColor: '#1415168c', borderRadius: 18, overflow: 'hidden', paddingVertical: 5, paddingHorizontal: 12 },
  elapsedBadge: { position: 'absolute', top: 8, right: 16, width: 56, height: 44 },
  elapsedText: { color: 'white', fontSize: 17, lineHeight: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  metric: { color: 'white', textAlign: 'center', fontWeight: '700', letterSpacing: -1.5, fontVariant: ['tabular-nums'], textShadowColor: '#0005', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 12, marginBottom: 12, alignSelf: 'stretch' },
  captureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 26 },
  zoom: { width: 58, height: 58 },
  record: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center' },
  recordCore: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#df544f' },
  stopCore: { width: 32, height: 32, borderRadius: 7 },
  captureLabel: { color: 'white', textAlign: 'center', fontSize: 15, lineHeight: 20, fontWeight: '500', marginTop: 12, textShadowColor: '#0009', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 7 },
});
