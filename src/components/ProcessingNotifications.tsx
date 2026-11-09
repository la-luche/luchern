import { useUser } from '@clerk/clerk-expo';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { setBackgroundCopy } from '../lib/backgroundRuntime';
import { useLang } from '../lib/i18n';
import { processingCopy } from '../lib/processingCopy';
import { setResultNotificationCopy } from '../lib/resultNotifications';
import { useRecordings } from '../lib/storage';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** Mounted inside AuthGate: a notification can only open this account's data. */
export function ProcessingNotifications() {
  const { user } = useUser();
  const { lang } = useLang();
  const { recordings, loading } = useRecordings({ includeGuests: true });
  const router = useRouter();
  const handled = useRef<string | undefined>(undefined);
  useEffect(() => {
    const copy = processingCopy[lang];
    setBackgroundCopy(copy.processingTitle, copy.processingBody);
    setResultNotificationCopy(copy.readyTitle, copy.readyBody, copy.channel);
  }, [lang]);
  useEffect(() => {
    if (Platform.OS === 'web' || loading || !user?.id) return;
    let cancelled = false;
    const open = (response: Notifications.NotificationResponse | null) => {
      if (cancelled) return;
      const data = response?.notification.request.content.data;
      if (data?.kind !== 'results-ready' || data.accountId !== user.id) return;
      const notificationId = response!.notification.request.identifier;
      if (handled.current === notificationId) return;
      const recording = recordings.find(r => r.id === data.recordingId && (r.guestId ?? null) === data.guestId);
      if (!recording) return;
      handled.current = notificationId;
      void Notifications.clearLastNotificationResponseAsync();
      if (typeof data.checkupId === 'string' && recording.evaluationRun?.id === data.checkupId) {
        router.push({ pathname: '/checkups/[id]', params: { id: data.checkupId, guestId: recording.guestId ?? '' } });
      } else {
        router.push({ pathname: '/results/[id]', params: { id: recording.id, guestId: recording.guestId ?? '' } });
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => { cancelled = true; subscription.remove(); };
  }, [user?.id, loading, recordings, router]);
  return null;
}
