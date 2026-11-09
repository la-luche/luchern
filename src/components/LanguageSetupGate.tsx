import type { ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { useLang, useT } from '../lib/i18n';
import { COLORS } from '../lib/theme';
import { LanguageList } from './LanguagePicker';
import { Screen } from './Screen';

/** Choose once before the warning; later launches restore the saved language. */
export function LanguageSetupGate({ children }: { children: ReactNode }) {
  const { isLoaded, hasChosenLanguage, setLang } = useLang();
  const t = useT();

  if (!isLoaded) {
    return <Screen><View className="flex-1 items-center justify-center">
      <ActivityIndicator color={COLORS.ink} />
    </View></Screen>;
  }
  if (hasChosenLanguage) return <>{children}</>;

  return (
    <Screen>
      <ScrollView contentContainerClassName="grow justify-center px-6 py-8" bounces={false}>
        <View className="w-full max-w-[440px] self-center">
          <Text accessibilityRole="header" className="mb-6 px-3 text-[28px] font-bold text-ink">
            {t.about.languageTitle}
          </Text>
          <LanguageList onSelect={setLang} />
        </View>
      </ScrollView>
    </Screen>
  );
}
