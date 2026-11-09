import { Redirect, useLocalSearchParams } from 'expo-router';

import { personHistoryHref } from '../../lib/personFlow';

/** Guest records now use the same history screen as every other person. */
export default function LegacyGuestRedirect() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <Redirect href={id
      ? personHistoryHref({ kind: 'guest', id })
      : { pathname: '/people', params: { mode: 'history' } }} />
  );
}
