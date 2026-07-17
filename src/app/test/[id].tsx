import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { DemoVideo, NumberedSteps } from '../../components/Instruction';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { useT } from '../../lib/i18n';
import { advanceSession, endSession, useSession } from '../../lib/session';
import { type EvaluatedSide, getTest } from '../../lib/tests';

/**
 * Per-test instruction guide, kept intentionally minimal for an older patient:
 * a demo clip (shows the movement), the test name, a few big plain-language
 * steps (phone setup folded into step 1), and one large button. During a
 * guided session it also shows "Test N of M" + a Skip control.
 */
export default function InstructionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const test = getTest(id);
  const t = useT();
  const session = useSession();
  const [evaluatedSide, setEvaluatedSide] = useState<EvaluatedSide | null>(null);
  useKeepAwake(); // don't let the screen dim/lock while a helper reads the steps

  useEffect(() => setEvaluatedSide(null), [id]);

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
    <Screen>
      <Header />

      {inSession && (
        <View className="mb-1 flex-row items-center justify-between px-6">
          <Text className="text-[13px] font-semibold text-ink-muted">
            {t.session.progress(session.position, session.total)}
          </Text>
          <Pressable
            onPress={skip}
            accessibilityRole="button"
            accessibilityLabel={t.session.skip}
            className="rounded-full px-3 py-1.5 active:opacity-60"
          >
            <Text className="text-[14px] font-semibold text-blue-600">{t.session.skip}</Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerClassName="px-6 pb-10">
        <DemoVideo
          source={test.demoVideo}
          poster={test.demoPoster}
          icon={test.icon}
          caption={test.demoVideo != null ? t.instruction.demoCaption : t.instruction.demoSoon}
        />

        <Text className="mt-6 text-[30px] font-bold text-ink">{tt.title}</Text>

        <View className="mt-6">
          <NumberedSteps steps={tt.steps} />
        </View>

        {test.sideSpecific && (
          <View className="mt-7">
            <Text className="text-[16px] font-semibold text-ink">
              {t.instruction.sidePrompt}
            </Text>
            <View className="mt-3 flex-row gap-3">
              {(['left', 'right'] as const).map((side) => {
                const selected = evaluatedSide === side;
                const label = side === 'left' ? t.instruction.leftSide : t.instruction.rightSide;
                return (
                  <Pressable
                    key={side}
                    onPress={() => setEvaluatedSide(side)}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected }}
                    className={`h-[52px] flex-1 items-center justify-center rounded-full border ${
                      selected ? 'border-ink bg-ink' : 'border-ink/20 bg-white'
                    }`}
                  >
                    <Text className={`text-[17px] font-semibold ${selected ? 'text-white' : 'text-ink'}`}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <View className="mt-9">
          <Button
            title={t.instruction.ready}
            disabled={test.sideSpecific && evaluatedSide == null}
            onPress={() =>
              router.push({
                pathname: '/record/[id]',
                params: { id: test.id, ...(evaluatedSide ? { side: evaluatedSide } : {}) },
              })
            }
          />
        </View>

        {/* Quiet footer: clinical reference only. The not-a-diagnosis reminder
            lives on the result screen (and the first-launch disclaimer) — no
            need to repeat it before every test. */}
        <Text className="mt-6 text-center text-[12px] leading-5 text-ink-muted">
          {test.updrsItem}
        </Text>
      </ScrollView>
    </Screen>
  );
}
