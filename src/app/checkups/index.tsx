import { Redirect, useLocalSearchParams } from 'expo-router';
import { historyPerson, personHistoryHref } from '../../lib/personFlow';

/** Preserve old links; both history tabs now share one native screen. */
export default function CheckupsHistoryScreen() {
  const { guestId, patientId } = useLocalSearchParams<{ guestId?: string; patientId?: string }>();
  return <Redirect href={personHistoryHref(historyPerson(guestId, patientId), 'checkups')} />;
}
