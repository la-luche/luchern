import { useUser } from '@clerk/clerk-expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { useT } from '../lib/i18n';
import { readHistorySelection } from '../lib/historySelection';
import { personHistoryHref } from '../lib/personFlow';

/** Main menu: check up, individual test, history, and account. */
export default function MenuScreen() {
  const router = useRouter();
  const t = useT();
  const { user } = useUser();
  const account = useRef(user?.id);
  account.current = user?.id;
  const mounted = useRef(true);
  const opening = useRef(false);
  const historyRequest = useRef(0);
  const [openingHistory, setOpeningHistory] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useFocusEffect(useCallback(() => {
    ++historyRequest.current;
    opening.current = false;
    setOpeningHistory(false);
    return () => { ++historyRequest.current; };
  }, []));
  const openScreen = (href: Href) => {
    ++historyRequest.current;
    router.push(href);
  };
  const openHistory = async () => {
    if (opening.current) return;
    opening.current = true;
    setOpeningHistory(true);
    const current = ++historyRequest.current;
    const accountId = account.current;
    try {
      const { person, section } = await readHistorySelection(accountId);
      if (mounted.current && historyRequest.current === current && account.current === accountId) router.push(personHistoryHref(person, section));
    } finally {
      if (historyRequest.current === current) {
        opening.current = false;
        if (mounted.current) setOpeningHistory(false);
      }
    }
  };

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 py-6"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        showsVerticalScrollIndicator={false}
      >
        {/* Recording actions followed by history and account navigation. */}
        <View className="w-full max-w-[440px] self-center gap-4">
          <Button title={t.menu.startFullCheck} size="large" onPress={() => openScreen({ pathname: '/people', params: { mode: 'full' } })} />
          <Button title={t.menu.recordOne} size="large" onPress={() => openScreen({ pathname: '/people', params: { mode: 'single' } })} />
          <Button
            title={t.menu.previousRecordings}
            size="large"
            variant="secondary"
            onPress={() => void openHistory()}
            disabled={openingHistory}
          />
          <Button
            title={t.profile.account}
            size="large"
            variant="secondary"
            onPress={() => openScreen('/about')}
          />
        </View>
      </ScrollView>
      <View className="px-6 pb-3 pt-2">
        <View className="w-full max-w-[440px] self-center">
          <Text className="text-center text-[17px] font-semibold leading-6 text-ink">
            {t.disclaimer.footerTitle}
          </Text>
          <Text className="mt-1 text-center text-[15px] leading-[22px] text-ink-muted">
            {t.disclaimer.footerBody}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
