import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { StepList } from '../../components/StepList';
import { getTest } from '../../lib/tests';
import { COLORS } from '../../lib/theme';

/** Per-test instruction guide. Continue → recording screen. */
export default function InstructionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const test = getTest(id);

  if (!test) return <Redirect href="/" />;

  return (
    <Screen>
      <Header />
      <ScrollView contentContainerClassName="px-6 pb-8">
        {/* Demo video placeholder. A looping demo clip drops in here later —
            for now, a labeled icon box keeps the layout honest. */}
        <View className="mt-2 aspect-video w-full items-center justify-center rounded-2xl bg-ink-faint">
          <MaterialCommunityIcons name={test.icon} size={72} color={COLORS.ink} />
          <Text className="mt-2 text-[12px] font-medium text-ink-muted">Demo video</Text>
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
