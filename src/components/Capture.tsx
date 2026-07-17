import { useVideoPlayer, VideoView } from 'expo-video';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Static (no-ML) framing guide drawn over the live preview: a centered guide
 * frame plus a short per-test hint. It doesn't track anyone — it just gives the
 * patient/helper something concrete to aim for, which cuts down on clips where
 * the body/hand is out of frame.
 */
export function FramingGuide() {
  return (
    <View pointerEvents="none" className="absolute inset-0">
      {/* Reserved top/bottom bands match the overlay chrome, so the guide can
          never sit underneath the labels or the enlarged capture controls. */}
      <View className="absolute inset-x-6 bottom-48 top-48 rounded-3xl border-2 border-white/70" />
    </View>
  );
}

/**
 * Review-before-submit panel: replays the clip that was just captured and lets
 * the patient confirm it looks right before anything is uploaded. Submit hands
 * the clip to storage/upload; Retake discards it and returns to the camera.
 */
export function ReviewPanel({
  uri,
  title,
  hint,
  submitLabel,
  retakeLabel,
  submitting,
  onSubmit,
  onRetake,
}: {
  uri: string;
  title: string;
  hint: string;
  submitLabel: string;
  retakeLabel: string;
  submitting: boolean;
  onSubmit: () => void;
  onRetake: () => void;
}) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.play();
  });

  return (
    <View className="absolute inset-0 bg-black">
      <SafeAreaView className="flex-1">
        <View className="flex-1 px-5 pt-3">
          <View className="flex-1 overflow-hidden rounded-2xl bg-black">
            <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
          </View>

          <Text className="mt-4 text-center text-[20px] font-bold text-white">{title}</Text>
          <Text className="mt-1 text-center text-[15px] leading-5 text-white/70">{hint}</Text>

          <View className="mt-5 gap-3 pb-3">
            <Pressable
              onPress={onSubmit}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={submitLabel}
              className={`h-16 flex-row items-center justify-center gap-2 rounded-full bg-white active:opacity-80 ${
                submitting ? 'opacity-60' : ''
              }`}
            >
              {submitting ? <ActivityIndicator color="#080616" /> : null}
              <Text className="text-[17px] font-semibold text-ink">{submitLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onRetake}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel={retakeLabel}
              className={`h-16 items-center justify-center rounded-full border border-white/40 active:opacity-70 ${
                submitting ? 'opacity-40' : ''
              }`}
            >
              <Text className="text-[17px] font-semibold text-white">{retakeLabel}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
