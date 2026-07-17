import { useClerk, useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { BUNDLED_GIT_COMMIT, BUNDLE_COMMIT_PREFIX } from '../generated/release';
import { Header } from '../components/Header';
import { LanguagePicker } from '../components/LanguagePicker';
import { Screen } from '../components/Screen';
import { useT } from '../lib/i18n';
import { exportDiagnostics } from '../lib/diagnostics';
import { useRecordings } from '../lib/storage';
import { COLORS } from '../lib/theme';

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
  const { user } = useUser();
  const { signOut } = useClerk();
  const { logoutAndPurge, unuploadedCount } = useRecordings();
  const [loggingOut, setLoggingOut] = useState(false);
  const gitCommit = BUNDLED_GIT_COMMIT;
  const bundledSha = gitCommit?.bundleMarker.startsWith(BUNDLE_COMMIT_PREFIX)
    ? gitCommit.bundleMarker.slice(BUNDLE_COMMIT_PREFIX.length)
    : null;

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

  const finishLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutAndPurge();
      await signOut();
      router.replace('/');
    } catch {
      Alert.alert(t.profile.logoutFailedTitle, t.profile.logoutFailedBody);
      setLoggingOut(false);
    }
  };

  const confirmLogout = () => {
    const hasUnuploaded = unuploadedCount > 0;
    Alert.alert(
      hasUnuploaded ? t.profile.unuploadedTitle : t.profile.logoutTitle,
      hasUnuploaded
        ? t.profile.unuploadedBody(unuploadedCount)
        : t.profile.logoutBody,
      [
        { text: t.common.cancel, style: 'cancel' },
        {
          text: hasUnuploaded ? t.profile.logoutAndDelete : t.profile.logout,
          style: 'destructive',
          onPress: () => void finishLogout(),
        },
      ],
    );
  };

  const email = user?.primaryEmailAddress?.emailAddress;
  const displayName = user?.fullName || user?.firstName || email || t.profile.account;

  return (
    <Screen>
      <Header title={t.about.title} />
      <ScrollView contentContainerClassName="px-6 pb-10">
        <Section title={t.profile.title}>
          <View className="rounded-2xl border border-ink-faint p-4">
            <View className="flex-row items-center">
              {user?.imageUrl ? (
                <Image
                  source={{ uri: user.imageUrl }}
                  className="h-14 w-14 rounded-full"
                  contentFit="cover"
                />
              ) : (
                <View className="h-14 w-14 items-center justify-center rounded-full bg-ink-faint">
                  <Ionicons name="person-outline" size={28} color={COLORS.ink} />
                </View>
              )}
              <View className="ml-4 flex-1">
                <Text className="text-[17px] font-semibold text-ink">{displayName}</Text>
                {!!email && email !== displayName && (
                  <Text numberOfLines={1} className="mt-1 text-[14px] text-ink-muted">
                    {email}
                  </Text>
                )}
              </View>
            </View>
            <Text className="mt-4 text-[14px] leading-5 text-ink-muted">
              {t.profile.syncDescription}
            </Text>
          </View>
          <View className="mt-3">
            <Button
              title={loggingOut ? t.profile.loggingOut : t.profile.logout}
              variant="secondary"
              onPress={confirmLogout}
              disabled={loggingOut}
            />
          </View>
        </Section>

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
          {gitCommit && bundledSha ? (
            <>
              <Text className="text-[15px] leading-6 text-ink/70">{gitCommit.message}</Text>
              <Text
                accessibilityRole="link"
                onPress={() => Linking.openURL(gitCommit.url)}
                selectable
                className="mt-2 font-mono text-[13px] leading-5 text-blue-600"
              >
                {bundledSha}
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
