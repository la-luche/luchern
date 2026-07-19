import { useClerk, useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, ScrollView, Text, View } from 'react-native';

import { Button } from '../components/Button';
import { BUNDLED_GIT_COMMIT, BUNDLE_COMMIT_PREFIX } from '../generated/release';
import { Header } from '../components/Header';
import { LanguagePicker } from '../components/LanguagePicker';
import { Screen } from '../components/Screen';
import { deleteAccount } from '../lib/api';
import { useT } from '../lib/i18n';
import { clearDiagnostics, exportDiagnostics } from '../lib/diagnostics';
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
  const { logoutAndPurge, restoreAfterFailedPurge, unuploadedCount } = useRecordings();
  const [loggingOut, setLoggingOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteCountdown, setDeleteCountdown] = useState<number | null>(null);
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
      // AuthGate unmounts the entire Stack as soon as Clerk signs out. Reset
      // the route while that navigator still exists; dispatching afterward
      // produces React Navigation's unhandled REPLACE(index) warning.
      router.replace('/');
      await signOut();
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

  const finishAccountDeletion = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    try {
      // Stop in-flight uploads and remove account-associated device data before
      // invalidating the Clerk identity used for the authenticated DELETE.
      await logoutAndPurge();
      await clearDiagnostics();
      await deleteAccount();
      router.replace('/');
      // Clerk may already reject the now-deleted identity. The backend deletion
      // succeeded, so local sign-out is best-effort and must not show failure.
      await signOut().catch(() => {});
    } catch {
      await restoreAfterFailedPurge().catch(() => {});
      Alert.alert(t.profile.deleteFailedTitle, t.profile.deleteFailedBody);
      setDeletingAccount(false);
    }
  };

  const showFinalDeleteConfirmation = () => {
    Alert.alert(t.profile.deleteFinalTitle, t.profile.deleteFinalBody, [
      { text: t.profile.keepAccount, style: 'cancel' },
      {
        text: t.profile.deleteEverything,
        style: 'destructive',
        onPress: () => void finishAccountDeletion(),
      },
    ]);
  };

  useEffect(() => {
    if (deleteCountdown == null) return;
    if (deleteCountdown <= 0) {
      setDeleteCountdown(null);
      const finalPrompt = setTimeout(showFinalDeleteConfirmation, 250);
      return () => clearTimeout(finalPrompt);
    }
    const timer = setTimeout(() => setDeleteCountdown((seconds) => (seconds ?? 1) - 1), 1000);
    return () => clearTimeout(timer);
  }, [deleteCountdown]);

  const confirmAccountDeletion = () => {
    Alert.alert(t.profile.deleteWarningTitle, t.profile.deleteWarningBody, [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.common.continue,
        style: 'destructive',
        onPress: () => setDeleteCountdown(5),
      },
    ]);
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
          <View className="mt-3 flex-row gap-3">
            <Button
              title={loggingOut ? t.profile.loggingOut : t.profile.logout}
              variant="secondary"
              onPress={confirmLogout}
              disabled={loggingOut || deletingAccount}
              className="flex-1 px-3"
            />
            <Button
              title={deletingAccount ? t.profile.deletingAccount : t.profile.deleteAccount}
              variant="destructive"
              onPress={confirmAccountDeletion}
              disabled={loggingOut || deletingAccount}
              className="flex-1 px-3"
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

      <Modal
        visible={deleteCountdown != null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteCountdown(null)}
      >
        <View className="flex-1 items-center justify-center bg-black/50 px-7">
          <View className="w-full max-w-sm rounded-3xl bg-white p-6">
            <Text className="text-center text-[22px] font-bold text-ink">
              {t.profile.deleteCountdownTitle}
            </Text>
            <Text className="mt-3 text-center text-[15px] leading-6 text-ink-muted">
              {t.profile.deleteCountdownBody(deleteCountdown ?? 0)}
            </Text>
            <Text className="mt-5 text-center text-[48px] font-bold text-red-600">
              {deleteCountdown}
            </Text>
            <View className="mt-5">
              <Button
                title={t.profile.keepAccount}
                variant="secondary"
                onPress={() => setDeleteCountdown(null)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
