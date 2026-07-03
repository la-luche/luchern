import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useT } from '../lib/i18n';
import { COLORS } from '../lib/theme';
import { Button } from './Button';

const ACCEPTED_KEY = 'luche.disclaimerAccepted.v1';

/**
 * First-launch medical disclaimer. Both App Store (guideline 1.4.1) and Play's
 * Health-apps policy scrutinize symptom-scoring apps — surfacing a clear
 * "not a medical device / not for diagnosis" notice up front lowers rejection
 * risk. Acceptance is persisted so it only shows once.
 */
export function DisclaimerGate({ children }: { children: ReactNode }) {
  const t = useT();
  // undefined = still loading, true/false = resolved
  const [accepted, setAccepted] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(ACCEPTED_KEY).then((v) => setAccepted(v === 'true'));
  }, []);

  if (accepted === undefined) {
    return <View className="flex-1 bg-white" />;
  }

  if (accepted) return <>{children}</>;

  const accept = () => {
    AsyncStorage.setItem(ACCEPTED_KEY, 'true');
    setAccepted(true);
  };

  return (
    <View className="flex-1 bg-white">
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="grow justify-center px-7 py-10">
          <View className="mb-6 items-center">
            <MaterialCommunityIcons name="shield-alert-outline" size={56} color={COLORS.ink} />
          </View>
          <Text className="mb-4 text-center text-[26px] font-bold text-ink">
            {t.disclaimer.title}
          </Text>
          <Text className="mb-3 text-center text-[16px] leading-6 text-ink/70">
            {t.disclaimer.body1lead}
            <Text className="font-semibold text-ink">{t.disclaimer.notMedicalDevice}</Text>
            {t.disclaimer.body1tail}
          </Text>
          <Text className="mb-8 text-center text-[16px] leading-6 text-ink/70">
            {t.disclaimer.body2}
          </Text>
          <Button title={t.common.iUnderstand} onPress={accept} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
