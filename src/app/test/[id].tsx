import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';

import { DemoVideo } from '../../components/Instruction';
import { useT } from '../../lib/i18n';
import { advanceSession, endSession, useSession } from '../../lib/session';
import { getTest } from '../../lib/tests';
import { COLORS } from '../../lib/theme';

const TEXT_SHADOW = {
  textShadowColor: 'rgba(0, 0, 0, 0.95)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
} as const;

const SCRIM_FADE_HEIGHT = 220;

const styles = StyleSheet.create({
  lowerScrim: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    top: -SCRIM_FADE_HEIGHT,
  },
  scrimFade: {
    height: SCRIM_FADE_HEIGHT,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  scrimBody: {
    backgroundColor: '#000',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: SCRIM_FADE_HEIGHT,
  },
  bottomSafeArea: {
    backgroundColor: '#000',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 10,
  },
});

/** A content-sized lower scrim: dark behind copy, transparent above it. */
function InstructionScrim() {
  return (
    <View pointerEvents="none" style={styles.lowerScrim}>
      <Svg width="100%" height={SCRIM_FADE_HEIGHT} style={styles.scrimFade}>
        <Defs>
          <SvgLinearGradient id="instruction-scrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0} />
            <Stop offset="0.2" stopColor="#000" stopOpacity={0.02} />
            <Stop offset="0.35" stopColor="#000" stopOpacity={0.06} />
            <Stop offset="0.48" stopColor="#000" stopOpacity={0.14} />
            <Stop offset="0.6" stopColor="#000" stopOpacity={0.28} />
            <Stop offset="0.72" stopColor="#000" stopOpacity={0.48} />
            <Stop offset="0.82" stopColor="#000" stopOpacity={0.68} />
            <Stop offset="0.9" stopColor="#000" stopOpacity={0.84} />
            <Stop offset="0.96" stopColor="#000" stopOpacity={0.94} />
            <Stop offset="1" stopColor="#000" stopOpacity={1} />
          </SvgLinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#instruction-scrim)" />
      </Svg>
      <View style={styles.scrimBody} />
    </View>
  );
}

function OverlaySteps({ steps }: { steps: readonly string[] }) {
  return (
    <View className="gap-4">
      {steps.map((step, index) => (
        <View key={index} className="flex-row items-start gap-3.5">
          <Text
            accessible={false}
            className="w-7 text-center text-[22px] leading-7 text-white"
            style={TEXT_SHADOW}
          >
            ✣
          </Text>
          <Text className="flex-1 text-[18px] font-medium leading-7 text-white" style={TEXT_SHADOW}>
            {step}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Per-test instruction guide, kept intentionally minimal for an older patient:
 * a demo clip (shows the movement), a few big plain-language steps (phone setup
 * folded into step 1), and one large button. During a guided session it also
 * shows "Test N of M" + a Skip control.
 */
export default function InstructionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const test = getTest(id);
  const t = useT();
  const session = useSession();
  const insets = useSafeAreaInsets();
  useKeepAwake(); // don't let the screen dim/lock while a helper reads the steps

  if (!test) return <Redirect href="/" />;

  const tt = t.tests[test.id];
  const inSession = session.active && session.current === test.id;

  const skip = () => {
    const next = advanceSession();
    if (next) {
      router.replace({ pathname: '/test/[id]', params: { id: next } });
    } else {
      endSession();
      router.replace('/results');
    }
  };

  return (
    <View className="flex-1 bg-black">
      <StatusBar style="light" />

      <DemoVideo
        fullScreen
        source={test.demoVideo}
        poster={test.demoPoster}
        icon={test.icon}
        caption={test.demoVideo != null ? t.instruction.demoCaption : t.instruction.demoSoon}
        framing={test.demoFraming}
      />

      <SafeAreaView
        edges={['top', 'left', 'right']}
        className="flex-1"
      >
        <View className="h-16 flex-row items-center justify-between px-4">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t.common.back}
            className="h-12 w-12 items-center justify-center rounded-full bg-black/45 active:opacity-70"
          >
            <Ionicons name="chevron-back" size={30} color={COLORS.white} />
          </Pressable>

          {inSession ? (
            <Text className="rounded-full bg-black/45 px-3 py-2 text-[13px] font-semibold text-white">
              {t.session.progress(session.position, session.total)}
            </Text>
          ) : (
            <View />
          )}

          {inSession ? (
            <Pressable
              onPress={skip}
              accessibilityRole="button"
              accessibilityLabel={t.session.skip}
              className="min-h-12 min-w-12 items-center justify-center rounded-full bg-black/45 px-3 active:opacity-70"
            >
              <Text className="text-[14px] font-bold text-white">{t.session.skip}</Text>
            </Pressable>
          ) : (
            <View className="h-12 w-12" />
          )}
        </View>

        <View className="flex-1 justify-end">
          {/* The action never scrolls off-screen. Only unusually long localized
              copy scrolls within the dark lower panel above it. */}
          <View style={{ maxHeight: '82%', backgroundColor: '#000' }}>
            <InstructionScrim />
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerClassName="px-6 pb-3 pt-1"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <OverlaySteps steps={tt.steps} />
            </ScrollView>

            <View
              className="px-6 pt-2"
              style={{
                backgroundColor: '#000',
                paddingBottom: Math.max(insets.bottom, 12),
              }}
            >
              <Pressable
                onPress={() => router.push({ pathname: '/record/[id]', params: { id: test.id } })}
                accessibilityRole="button"
                accessibilityLabel={t.instruction.ready}
                className="h-16 items-center justify-center rounded-full bg-white px-6 active:opacity-80"
              >
                <Text className="text-[18px] font-bold text-ink">{t.instruction.ready}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </SafeAreaView>
      <View
        pointerEvents="none"
        style={[styles.bottomSafeArea, { height: Math.max(insets.bottom, 12) }]}
      />
    </View>
  );
}
