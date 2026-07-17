import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { Header } from '../components/Header';
import { LanguagePicker } from '../components/LanguagePicker';
import { Screen } from '../components/Screen';
import { useT } from '../lib/i18n';
import { exportDiagnostics } from '../lib/diagnostics';

type GitCommit = {
  message: string;
  sha: string;
  url: string;
};

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
  const router = useRouter();
  const gitCommit = Constants.expoConfig?.extra?.gitCommit as GitCommit | null | undefined;

  const shareDiagnostics = async () => {
    try {
      if (!FileSystem.cacheDirectory || !(await Sharing.isAvailableAsync())) {
        throw new Error('sharing unavailable');
      }
      const uri = `${FileSystem.cacheDirectory}luche-diagnostics.json`;
      await FileSystem.writeAsStringAsync(uri, await exportDiagnostics());
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: t.about.diagnosticsShareTitle,
        UTI: 'public.json',
      });
    } catch {
      Alert.alert(t.about.diagnosticsFailedTitle, t.about.diagnosticsFailedBody);
    }
  };

  return (
    <Screen>
      <Header title={t.about.title} />
      <ScrollView contentContainerClassName="px-6 pb-10">
        <Section title={t.invite.title}>
          <Button
            title={t.invite.enterButton}
            variant="secondary"
            onPress={() => router.push('/invite')}
          />
          <View className="mt-3">
            <Button
              title={t.generate.generate}
              variant="secondary"
              onPress={() => router.push('/share-code')}
            />
          </View>
        </Section>

        <Section title={t.about.languageTitle}>
          <LanguagePicker />
        </Section>

        <Section title={t.about.disclaimerTitle}>
          <Text className="text-[15px] leading-6 text-ink/70">{t.about.disclaimerBody}</Text>
        </Section>

        <Section title={t.about.privacyTitle}>
          <Text className="text-[15px] leading-6 text-ink/70">{t.about.privacyBody}</Text>
        </Section>

        <Section title={t.about.supportTitle}>
          <Text className="mb-3 text-[15px] leading-6 text-ink/70">
            {t.about.diagnosticsBody}
          </Text>
          <Button title={t.about.exportDiagnostics} variant="secondary" onPress={shareDiagnostics} />
        </Section>

        <Section title={t.about.versionTitle}>
          <Text className="text-[15px] text-ink/70">{t.about.versionValue}</Text>
        </Section>

        <Section title={t.about.commitTitle}>
          {gitCommit ? (
            <>
              <Text className="text-[15px] leading-6 text-ink/70">{gitCommit.message}</Text>
              <Text
                accessibilityRole="link"
                onPress={() => Linking.openURL(gitCommit.url)}
                selectable
                className="mt-2 font-mono text-[13px] leading-5 text-blue-600"
              >
                {gitCommit.sha}
              </Text>
            </>
          ) : (
            <Text className="text-[15px] text-ink/70">{t.about.commitUnavailable}</Text>
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}
