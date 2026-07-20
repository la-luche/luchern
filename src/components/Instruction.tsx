import { MaterialCommunityIcons } from '@expo/vector-icons';
import { VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { useDemoVideoPlayer } from './DemoVideoProvider';
import { COLORS } from '../lib/theme';

type MCIName = ComponentProps<typeof MaterialCommunityIcons>['name'];

// One-off warm/status accents for the instruction screen. Kept local (not in the
// ink palette) because they only ever appear here.
const BLUE = '#1E6FD0';
const BLUE_TINT = '#EAF3FE';
const GOOD = '#1F9D57';
const AVOID = '#C77700';

/**
 * Looping, muted demo clip backed by the app-lifetime player cache. The poster
 * stays on top until VideoView confirms that it rendered a frame; player status
 * alone is too early and briefly exposes the empty native video surface.
 */
export function DemoVideo({
  source,
  poster,
  icon,
  caption,
  fullScreen = false,
}: {
  source?: number;
  poster?: number;
  icon: MCIName;
  caption: string;
  fullScreen?: boolean;
}) {
  const player = useDemoVideoPlayer(source);
  const hasVideo = player != null;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [renderedPlayer, setRenderedPlayer] = useState<VideoPlayer | null>(null);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  // Comparing by player identity resets the cover immediately when a guided
  // session replaces one instruction route with the next.
  const firstFrameRendered = player != null && renderedPlayer === player;

  // Autoplay the loop — unless the OS "reduce motion" setting is on, in which
  // case hold the first frame still.
  useEffect(() => {
    if (player == null) return;
    if (reduceMotion) player.pause();
    else player.play();
    return () => player.pause();
  }, [reduceMotion, player]);

  const video = (
    <>
      {hasVideo && (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit={fullScreen ? 'cover' : 'contain'}
          nativeControls={false}
          // Android's default SurfaceView can sit above React Native overlays.
          // TextureView keeps the scrim and instructions reliably on top.
          surfaceType="textureView"
          accessibilityLabel={caption}
          onFirstFrameRender={() => setRenderedPlayer(player)}
        />
      )}
      {!firstFrameRendered &&
        (poster != null ? (
          <Image
            source={poster}
            resizeMode={fullScreen ? 'cover' : 'contain'}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View className="absolute inset-0 items-center justify-center gap-3 bg-ink-faint">
            <MaterialCommunityIcons name={icon} size={44} color={COLORS.inkMuted} />
            {hasVideo ? <ActivityIndicator color={COLORS.inkMuted} /> : null}
          </View>
        ))}
    </>
  );

  if (fullScreen) {
    return (
      <View pointerEvents="none" className="absolute inset-0 overflow-hidden bg-ink">
        {video}
      </View>
    );
  }

  return (
    <View className="mt-2">
      <View className="aspect-video w-full overflow-hidden rounded-3xl bg-ink-faint">
        {video}
      </View>
      <Text className="mt-2 text-center text-[13px] text-ink-muted">{caption}</Text>
    </View>
  );
}

/**
 * Small uppercase section label above each block, with an optional faint gray
 * anchor icon so the user can orient themselves while scrolling. The icon is
 * low-opacity on purpose — a wayfinding cue, not a focal point.
 */
export function SectionLabel({ icon, children }: { icon?: MCIName; children: ReactNode }) {
  return (
    <View className="mb-2 flex-row items-center gap-2">
      {icon ? (
        <MaterialCommunityIcons name={icon} size={20} color={COLORS.inkMuted} />
      ) : null}
      <Text className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
        {children}
      </Text>
    </View>
  );
}

/** "Set up your phone" card — soft blue tint + phone icon. */
export function SetupCard({ text }: { text: string }) {
  return (
    <View className="flex-row gap-3 rounded-2xl p-4" style={{ backgroundColor: BLUE_TINT }}>
      <MaterialCommunityIcons name="cellphone" size={22} color={BLUE} />
      <Text className="flex-1 text-[16px] leading-6 text-ink">{text}</Text>
    </View>
  );
}

/** Numbered "what to do" steps with filled ink badges. Large + airy for older eyes. */
export function NumberedSteps({ steps }: { steps: readonly string[] }) {
  return (
    <View className="gap-5">
      {steps.map((step, i) => (
        <View key={i} className="flex-row items-center gap-3.5">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-ink">
            <Text className="text-[17px] font-bold text-white">{i + 1}</Text>
          </View>
          <Text className="flex-1 text-[19px] leading-7 text-ink">{step}</Text>
        </View>
      ))}
    </View>
  );
}

/** "For a good result" — a do (green check) / avoid (amber alert) pair. */
export function Cues({ good, avoid }: { good: string; avoid: string }) {
  return (
    <View className="gap-3 rounded-2xl bg-ink-faint p-4">
      <View className="flex-row items-start gap-2.5">
        <MaterialCommunityIcons name="check-circle" size={20} color={GOOD} />
        <Text className="flex-1 text-[15px] leading-5 text-ink">{good}</Text>
      </View>
      <View className="flex-row items-start gap-2.5">
        <MaterialCommunityIcons name="alert-circle" size={20} color={AVOID} />
        <Text className="flex-1 text-[15px] leading-5 text-ink-muted">{avoid}</Text>
      </View>
    </View>
  );
}
