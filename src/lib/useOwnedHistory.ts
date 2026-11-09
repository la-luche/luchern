import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useRecordings } from './storage';

/** Preserve the local list while refreshing the same person's cloud history. */
export function useOwnedHistory(guestId?: string) {
  const { recordings, loading, refresh: refreshRecordings } = useRecordings({ guestId });
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    setRefreshing(true);
    setFailed(false);
    try { await refreshRecordings(); }
    catch { if (current === request.current) setFailed(true); }
    finally { if (current === request.current) setRefreshing(false); }
  }, [refreshRecordings]);
  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { ++request.current; };
  }, [refresh]));
  return { recordings, loading, refreshing, failed, refresh };
}
