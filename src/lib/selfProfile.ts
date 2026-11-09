import { useUser } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from './api';

export type SelfProfile = { name: string; notes: string };
type Payload = { display_name: string | null; notes?: string };
const prefix = 'luche.self-profile.v1.';
const profiles = new Map<string, SelfProfile>();
const revisions = new Map<string, number>();
const listeners = new Set<() => void>();
const loads = new Map<string, Promise<void>>();
const writes = new Map<string, Promise<void>>();
const fromPayload = (p: Payload): SelfProfile => ({ name: p.display_name ?? '', notes: p.notes ?? '' });
const emit = () => { for (const listener of listeners) listener(); };
function persist(accountId: string, profile: SelfProfile, revision: number) {
  const write = (writes.get(accountId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if ((revisions.get(accountId) ?? 0) === revision) await AsyncStorage.setItem(prefix + accountId, JSON.stringify(profile));
  });
  writes.set(accountId, write);
  return write;
}

async function refresh(accountId: string) {
  const existing = loads.get(accountId);
  if (existing) return existing;
  const revision = revisions.get(accountId) ?? 0;
  const load = (async () => {
    if (!profiles.has(accountId)) {
      const raw = await AsyncStorage.getItem(prefix + accountId);
      if (raw && !profiles.has(accountId) && (revisions.get(accountId) ?? 0) === revision) {
        try {
          const saved = JSON.parse(raw);
          if (typeof saved.name === 'string' && typeof saved.notes === 'string') { profiles.set(accountId, saved); emit(); }
        } catch { /* Ignore a corrupt cache and read the server. */ }
      }
    }
    const profile = fromPayload(await apiFetch<Payload>('/me', {}, accountId));
    if ((revisions.get(accountId) ?? 0) !== revision) return;
    profiles.set(accountId, profile); emit();
    await persist(accountId, profile, revision);
  })().finally(() => loads.delete(accountId));
  loads.set(accountId, load);
  return load;
}

export async function updateSelfProfile(accountId: string, fields: SelfProfile) {
  const revision = (revisions.get(accountId) ?? 0) + 1;
  revisions.set(accountId, revision);
  const profile = fromPayload(await apiFetch<Payload>('/me', {
    method: 'PATCH', body: JSON.stringify(fields),
  }, accountId));
  if (revisions.get(accountId) !== revision) throw new Error('profile request superseded');
  profiles.set(accountId, profile); emit();
  await persist(accountId, profile, revision);
  return profile;
}

export function useSelfProfile(enabled = true) {
  const { user } = useUser();
  const accountId = user?.id;
  const [, rerender] = useState(0);
  const savedProfile = accountId ? profiles.get(accountId) : undefined;
  // Onboarding used the sign-in email as a display-name fallback. It is not
  // the person's chosen label; let each screen use its localized “Me”.
  const isEmailDefault = !!savedProfile?.name && [user?.primaryEmailAddress, ...(user?.emailAddresses ?? [])]
    .some(address => address?.emailAddress.trim().toLowerCase() === savedProfile.name.trim().toLowerCase());
  const profile = useMemo(() => savedProfile && isEmailDefault ? { ...savedProfile, name: '' } : savedProfile,
    [savedProfile, isEmailDefault]);
  const [loading, setLoading] = useState(enabled && !!accountId && !profiles.has(accountId));
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    if (!enabled || !accountId) return;
    setFailed(false);
    try { await refresh(accountId); }
    catch { setFailed(true); }
    finally { setLoading(false); }
  }, [accountId, enabled]);
  useEffect(() => {
    const notify = () => rerender(n => n + 1);
    listeners.add(notify);
    void reload();
    return () => { listeners.delete(notify); };
  }, [reload]);
  return { profile, loading, failed, refresh: reload };
}

export async function clearSelfProfiles() {
  for (const id of new Set([...profiles.keys(), ...loads.keys(), ...writes.keys()])) revisions.set(id, (revisions.get(id) ?? 0) + 1);
  await Promise.allSettled([...writes.values()]);
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
  await AsyncStorage.multiRemove(keys);
  profiles.clear(); writes.clear(); emit();
}
