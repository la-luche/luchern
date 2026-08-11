import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const FACE_STORAGE_KEY = 'luche.face-blur.enabled.v1';
const BACKGROUND_STORAGE_KEY = 'luche.background-blur.enabled.v1';

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
    loading = AsyncStorage.multiGet([FACE_STORAGE_KEY, BACKGROUND_STORAGE_KEY])
      .then((entries) => {
        const values = Object.fromEntries(entries);
        cached = {
          face: values[FACE_STORAGE_KEY] === 'true',
          background: values[BACKGROUND_STORAGE_KEY] === 'true',
        };
        return cached;
      })
      .catch(() => {
        cached = { face: false, background: false };
        return cached;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export async function setPrivacyBlurSetting(
  setting: keyof PrivacyBlurSettings,
  enabled: boolean,
): Promise<void> {
  const key = setting === 'face' ? FACE_STORAGE_KEY : BACKGROUND_STORAGE_KEY;
  await AsyncStorage.setItem(key, enabled ? 'true' : 'false');
  cached = { ...(cached ?? await getPrivacyBlurSettings()), [setting]: enabled };
  emit(cached);
}

export function usePrivacyBlurSettings() {
  const [settings, setSettings] = useState<PrivacyBlurSettings>(
    cached ?? { face: false, background: false },
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

  const update = useCallback(async (setting: keyof PrivacyBlurSettings, next: boolean) => {
    const previous = settings;
    setSettings({ ...settings, [setting]: next });
    try {
      await setPrivacyBlurSetting(setting, next);
    } catch (error) {
      setSettings(previous);
      throw error;
    }
  }, [settings]);

  return { ...settings, isLoading, setEnabled: update };
}

export const __testing = {
  reset() {
    cached = null;
    loading = null;
    listeners.clear();
  },
  faceStorageKey: FACE_STORAGE_KEY,
  backgroundStorageKey: BACKGROUND_STORAGE_KEY,
};
