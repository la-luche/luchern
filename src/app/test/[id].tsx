import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { StepList } from '../../components/StepList';
import { getTest } from '../../lib/tests';

/** Per-test instruction guide. Continue → recording screen. */
export default function InstructionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const test = getTest(id);

  const player = useVideoPlayer(test?.demoVideo ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  if (!test) return <Redirect href="/" />;

  return (
    <Screen>
      <Header />
      <ScrollView contentContainerClassName="px-6 pb-8">
        {/* Looping, muted demo clip (from the old iOS app). */}
        <View className="mt-2 aspect-video w-full overflow-hidden rounded-2xl bg-ink-faint">
          <VideoView
            player={player}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            nativeControls={false}
            accessibilityLabel={`${test.displayName} demonstration video`}
          />
        </View>

        <Text className="mt-6 text-[28px] font-bold text-ink">{test.instructionTitle}</Text>
        <Text className="mt-1 text-[13px] font-medium text-ink-muted">{test.updrsItem}</Text>

        <View className="mt-6">
          <StepList steps={test.instructionSteps} />
        </View>

        <View className="mt-8">
          <Button
            title="Continue"
            onPress={() => router.push({ pathname: '/record/[id]', params: { id: test.id } })}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
