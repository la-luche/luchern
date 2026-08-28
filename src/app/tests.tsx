import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { TestRow } from '../components/TestRow';
import { useT } from '../lib/i18n';
import { endSession } from '../lib/session';
import { TESTS } from '../lib/tests';

/** Shared single-test picker for the signed-in person and for guests. */
export default function TestPickerScreen() {
  const { guestId } = useLocalSearchParams<{ guestId?: string }>();
  const router = useRouter();
  const t = useT();

  const openTest = (id: string) => {
    endSession();
    router.push({
      pathname: '/prepare',
      params: { mode: 'single', id, ...(guestId ? { guestId } : {}) },
    });
  };

  return (
    <Screen>
      <Header title={t.menu.chooseTest} />
      <ScrollView contentContainerClassName="gap-3.5 px-6 pb-10 pt-3">
        {TESTS.map((test) => (
          <TestRow key={test.id} test={test} onPress={() => openTest(test.id)} />
        ))}
        <View className="h-2" />
      </ScrollView>
    </Screen>
  );
}
