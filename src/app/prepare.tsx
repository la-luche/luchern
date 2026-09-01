import { Ionicons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { useT } from '../lib/i18n';
import { endSession, useSession } from '../lib/session';
import { getTest } from '../lib/tests';
import { COLORS } from '../lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function PreparationItem({
  icon,
  title,
  body,
}: {
  icon: IconName;
  title: string;
  body: string;
}) {
  return (
    <View className="flex-row items-start gap-4 rounded-3xl bg-ink-faint px-5 py-5">
      <View className="h-11 w-11 items-center justify-center rounded-full bg-white">
        <Ionicons name={icon} size={23} color={COLORS.ink} />
      </View>
      <View className="flex-1 pt-0.5">
        <Text className="text-[17px] font-semibold text-ink">{title}</Text>
        <Text className="mt-1 text-[15px] leading-6 text-ink-muted">{body}</Text>
      </View>
    </View>
  );
}

/** One shared recording setup screen, shown once before a full or single test. */
export default function PreparationScreen() {
  const { mode, id, guestId } = useLocalSearchParams<{
    mode?: string;
    id?: string;
    guestId?: string;
  }>();
  const router = useRouter();
  const t = useT();
  const session = useSession();
  const isFullCheck = mode === 'full';
  const singleTest = getTest(id);

  if (isFullCheck && (!session.active || !session.current)) return <Redirect href="/" />;
  if (!isFullCheck && !singleTest) return <Redirect href="/tests" />;

  const goBack = () => {
    if (isFullCheck) endSession();
    router.back();
  };

  const continueToTest = () => {
    const testId = isFullCheck ? session.current?.testId : singleTest?.id;
    if (!testId) return;
    router.replace({
      pathname: '/test/[id]',
      params: { id: testId, ...(guestId ? { guestId } : {}) },
    });
  };

  return (
    <Screen>
      <Header title={t.preparation.title} onBack={goBack} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-6 pb-6 pt-3"
        showsVerticalScrollIndicator={false}
      >
        <Text className="mb-2 text-[18px] leading-7 text-ink-muted">
          {isFullCheck ? t.preparation.fullIntro : t.preparation.singleIntro}
        </Text>

        <PreparationItem
          icon="scan-outline"
          title={t.preparation.frameTitle}
          body={t.preparation.frameBody}
        />
        <PreparationItem
          icon="sunny-outline"
          title={t.preparation.lightTitle}
          body={t.preparation.lightBody}
        />
        <PreparationItem
          icon="refresh-outline"
          title={t.preparation.reviewTitle}
          body={isFullCheck ? t.preparation.fullReviewBody : t.preparation.reviewBody}
        />
      </ScrollView>

      <View className="px-6 pb-3 pt-2">
        <Button
          title={isFullCheck ? t.preparation.startFull : t.preparation.continueSingle}
          onPress={continueToTest}
        />
      </View>
    </Screen>
  );
}
