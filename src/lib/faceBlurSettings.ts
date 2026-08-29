import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const FACE_STORAGE_KEY = 'luche.face-blur.enabled.v1';
const BACKGROUND_STORAGE_KEY = 'luche.background-blur.enabled.v1';
const DEPERSONALISATION_STORAGE_KEY = 'luche.depersonalisation.enabled.v1';

export type PrivacyBlurSettings = {
  face: boolean;
  background: boolean;
};

let cached: PrivacyBlurSettings | null = null;
let loading: Promise<PrivacyBlurSettings> | null = null;
const listeners = new Set<(settings: PrivacyBlurSettings) => void>();

function emit(settings: PrivacyBlurSettings) {
  for (const listener of listeners) listener(settings);
}

export async function getPrivacyBlurSettings(): Promise<PrivacyBlurSettings> {
  if (cached != null) return cached;
  if (!loading) {
    loading = AsyncStorage.multiGet([
      DEPERSONALISATION_STORAGE_KEY,
      FACE_STORAGE_KEY,
      BACKGROUND_STORAGE_KEY,
    ])
      .then(async (entries) => {
        const values = Object.fromEntries(entries);
        const stored = values[DEPERSONALISATION_STORAGE_KEY];
        const enabled = true;

        cached = { face: true, background: true };

        const hasLegacyPreference =
          values[FACE_STORAGE_KEY] != null || values[BACKGROUND_STORAGE_KEY] != null;
        if (stored == null && hasLegacyPreference) {
          const serialized = enabled ? 'true' : 'false';
          await AsyncStorage.multiSet([
            [DEPERSONALISATION_STORAGE_KEY, serialized],
            [FACE_STORAGE_KEY, serialized],
            [BACKGROUND_STORAGE_KEY, serialized],
          ]).catch(() => {});
        }

        return cached;
      })
      .catch(() => {
        // Privacy is mandatory for uploads. A settings read failure must never
        // turn into permission to upload an original.
        cached = { face: true, background: true };
        return cached;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export async function setPrivacyBlurEnabled(enabled: boolean): Promise<void> {
  const serialized = 'true';
  await AsyncStorage.multiSet([
    [DEPERSONALISATION_STORAGE_KEY, serialized],
    [FACE_STORAGE_KEY, serialized],
    [BACKGROUND_STORAGE_KEY, serialized],
  ]);
  cached = { face: true, background: true };
  emit(cached);
}

export function usePrivacyBlurSettings() {
  const [settings, setSettings] = useState<PrivacyBlurSettings>(
    cached ?? { face: true, background: true },
  );
  const [isLoading, setIsLoading] = useState(cached == null);

  useEffect(() => {
    let mounted = true;
    const listener = (next: PrivacyBlurSettings) => {
      if (mounted) setSettings(next);
    };
    listeners.add(listener);
    void getPrivacyBlurSettings().then((next) => {
      if (!mounted) return;
      setSettings(next);
      setIsLoading(false);
    });
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback(async (_next: boolean) => {
    const previous = settings;
    setSettings({ face: true, background: true });
    try {
      await setPrivacyBlurEnabled(true);
    } catch (error) {
      setSettings(previous);
      throw error;
    }
  }, [settings]);

  return { enabled: settings.face && settings.background, isLoading, setEnabled: update };
}

export const __testing = {
  reset() {
    cached = null;
    loading = null;
    listeners.clear();
  },
  depersonalisationStorageKey: DEPERSONALISATION_STORAGE_KEY,
  faceStorageKey: FACE_STORAGE_KEY,
  backgroundStorageKey: BACKGROUND_STORAGE_KEY,
};
