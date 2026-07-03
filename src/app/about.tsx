import { Linking, ScrollView, Text, View } from 'react-native';

import { Header } from '../components/Header';
import { Screen } from '../components/Screen';
import { useT } from '../lib/i18n';

// TODO(store): this must point at a live privacy policy before submission —
// both App Store and Play require one for a camera app. Placeholder for now.
const PRIVACY_URL = 'https://getferal.ai/luche-privacy';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-6">
      <Text className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-muted">
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function AboutScreen() {
  const t = useT();
  return (
    <Screen>
      <Header title={t.about.title} />
      <ScrollView contentContainerClassName="px-6 pb-10">
        <Text className="mt-2 text-[28px] font-bold text-ink">{t.common.appName}</Text>
        <Text className="mt-1 text-[14px] text-ink-muted">{t.about.subtitle}</Text>

        <Section title={t.about.disclaimerTitle}>
          <Text className="text-[15px] leading-6 text-ink/70">{t.about.disclaimerBody}</Text>
        </Section>

        <Section title={t.about.privacyTitle}>
          <Text className="text-[15px] leading-6 text-ink/70">{t.about.privacyBody}</Text>
          <Text
            onPress={() => Linking.openURL(PRIVACY_URL)}
            className="mt-3 text-[15px] font-semibold text-blue-600"
          >
            {t.about.privacyLink}
          </Text>
        </Section>

        <Section title={t.about.versionTitle}>
          <Text className="text-[15px] text-ink/70">{t.about.versionValue}</Text>
        </Section>
      </ScrollView>
    </Screen>
  );
}
