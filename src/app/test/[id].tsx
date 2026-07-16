import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { DemoVideo, NumberedSteps } from '../../components/Instruction';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { useT } from '../../lib/i18n';
import { getTest } from '../../lib/tests';

/**
 * Per-test instruction guide, kept intentionally minimal for an older patient:
 * a demo clip (shows the movement), the test name, a few big plain-language
 * steps (phone setup folded into step 1), and one large button. The clinical
 * reference + disclaimer sit in a small footer, not as their own blocks.
 */
export default function InstructionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const test = getTest(id);
  const t = useT();

  if (!test) return <Redirect href="/" />;

  const tt = t.tests[test.id];

  return (
    <Screen>
      <Header />
      <ScrollView contentContainerClassName="px-6 pb-10">
        <DemoVideo
          source={test.demoVideo}
          icon={test.icon}
          caption={test.demoVideo != null ? t.instruction.demoCaption : t.instruction.demoSoon}
        />

        <Text className="mt-6 text-[30px] font-bold text-ink">{tt.title}</Text>

        <View className="mt-6">
          <NumberedSteps steps={tt.steps} />
        </View>

        <View className="mt-9">
          <Button
            title={t.instruction.ready}
            onPress={() => router.push({ pathname: '/record/[id]', params: { id: test.id } })}
          />
        </View>

        {/* Quiet footer: clinical reference + the not-a-diagnosis reminder. */}
        <Text className="mt-6 text-center text-[12px] leading-5 text-ink-muted">
          {test.updrsItem} · {t.instruction.notDiagnosis}
        </Text>
      </ScrollView>
    </Screen>
  );
}
