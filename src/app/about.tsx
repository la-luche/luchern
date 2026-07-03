import { Linking, ScrollView, Text, View } from 'react-native';

import { Header } from '../components/Header';
import { Screen } from '../components/Screen';

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
  return (
    <Screen>
      <Header title="About" />
      <ScrollView contentContainerClassName="px-6 pb-10">
        <Text className="mt-2 text-[28px] font-bold text-ink">Luche</Text>
        <Text className="mt-1 text-[14px] text-ink-muted">Movement test recorder</Text>

        <Section title="Medical disclaimer">
          <Text className="text-[15px] leading-6 text-ink/70">
            Luche is a research and wellness tool. It is not a medical device and does not provide a
            diagnosis. Results are for informational purposes only — always consult a qualified
            clinician about your health.
          </Text>
        </Section>

        <Section title="Privacy">
          <Text className="text-[15px] leading-6 text-ink/70">
            Recordings are stored on your device. Analysis is performed in the cloud only when you
            record a test. Nothing else is collected.
          </Text>
          <Text
            onPress={() => Linking.openURL(PRIVACY_URL)}
            className="mt-3 text-[15px] font-semibold text-blue-600"
          >
            Privacy policy →
          </Text>
        </Section>

        <Section title="Version">
          <Text className="text-[15px] text-ink/70">1.0.0 (beta)</Text>
        </Section>
      </ScrollView>
    </Screen>
  );
}
