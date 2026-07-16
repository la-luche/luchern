import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Cues, DemoVideo, NumberedSteps, SectionLabel, SetupCard } from '../../components/Instruction';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { useT } from '../../lib/i18n';
import { getTest } from '../../lib/tests';

/**
 * Per-test instruction guide, reimagined to coach a patient through a correct
 * at-home capture: demo clip → what to expect → phone setup → steps → good/avoid
 * cues → reassurance → Continue. Warm, large-type, single scroll.
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
        <DemoVideo source={test.demoVideo} icon={test.icon} caption={t.instruction.demoCaption} />

        {/* Title + warm one-liner + time chip. */}
        <Text className="mt-6 text-[28px] font-bold text-ink">{tt.title}</Text>
        <Text className="mt-1 text-[16px] leading-6 text-ink-muted">{tt.blurb}</Text>
        <View className="mt-3 self-start rounded-full bg-ink-faint px-3 py-1.5">
          <Text className="text-[13px] font-semibold text-ink-muted">{tt.timeEstimate}</Text>
        </View>

        <View className="mt-7">
          <SectionLabel icon="cellphone">{t.instruction.setupTitle}</SectionLabel>
          <SetupCard text={tt.setup} />
        </View>

        <View className="mt-7">
          <SectionLabel icon="format-list-numbered">{t.instruction.stepsTitle}</SectionLabel>
          <NumberedSteps steps={tt.steps} />
        </View>

        <View className="mt-7">
          <SectionLabel icon="lightbulb-on-outline">{t.instruction.tipsTitle}</SectionLabel>
          <Cues good={tt.goodTip} avoid={tt.avoidTip} />
        </View>

        {/* Reassurance. */}
        <View className="mt-8 items-center px-2">
          <Text className="text-center text-[14px] leading-5 text-ink-muted">
            {t.instruction.reassurance}
          </Text>
          <Text className="mt-1 text-center text-[13px] text-ink-muted">
            {t.instruction.notDiagnosis}
          </Text>
        </View>

        <View className="mt-6">
          <Button
            title={t.instruction.ready}
            onPress={() => router.push({ pathname: '/record/[id]', params: { id: test.id } })}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
