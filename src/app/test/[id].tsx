import { useKeepAwake } from 'expo-keep-awake';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { DemoVideo, NumberedSteps } from '../../components/Instruction';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { useT } from '../../lib/i18n';
import { advanceSession, endSession, useSession } from '../../lib/session';
import { getTest } from '../../lib/tests';

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

        <View className="mt-9">
          <Button
            title={t.instruction.ready}
            onPress={() => router.push({ pathname: '/record/[id]', params: { id: test.id } })}
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
