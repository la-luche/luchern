import type { ReactNode } from 'react';
import { useState } from 'react';
import { Linking, Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useT } from '../lib/i18n';
import { METHODOLOGY_URL } from '../lib/links';
import { Button } from './Button';

/**
 * Show once per app launch. Keep screens mounted
 * underneath so acknowledging the warning never resets the current task.
 */
export function DisclaimerGate({ children }: { children: ReactNode }) {
  const t = useT();
  const [visible, setVisible] = useState(true);

  return (
    <View className="flex-1 bg-white">
      <View
        className="flex-1"
        accessibilityElementsHidden={visible}
        importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}
        pointerEvents={visible ? 'none' : 'auto'}
      >
        {children}
      </View>
      <Modal visible={visible} transparent animationType="none" onRequestClose={() => {}}>
        <SafeAreaView className="flex-1 bg-black/50">
          <ScrollView
            contentContainerClassName="grow items-center justify-center px-6 py-8"
            bounces={false}
          >
            <View accessibilityViewIsModal className="w-full max-w-[440px] rounded-2xl bg-white p-6">
              <Text accessibilityRole="header" className="text-center text-[26px] font-bold leading-[32px] text-ink">
                {t.disclaimer.title}
              </Text>
              <Text className="mt-4 text-center text-[18px] leading-7 text-ink-muted">
                {t.disclaimer.body1lead}
                <Text className="font-semibold text-ink">{t.disclaimer.notMedicalDevice}</Text>
                {t.disclaimer.body1tail}
              </Text>
              <Text className="mt-3 text-center text-[16px] leading-6 text-ink-muted">
                {t.disclaimer.body2}
              </Text>
              <View className="mt-6 gap-3">
                <Button title={t.profile.scienceMethodology} variant="secondary" onPress={() => void Linking.openURL(METHODOLOGY_URL)} />
                <Button title={t.common.iUnderstand} onPress={() => setVisible(false)} />
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
