import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'luche.face-blur.enabled.v1';

let cached: boolean | null = null;
let loading: Promise<boolean> | null = null;
const listeners = new Set<(enabled: boolean) => void>();

function emit(enabled: boolean) {
  for (const listener of listeners) listener(enabled);
}

export async function getFaceBlurEnabled(): Promise<boolean> {
  if (cached != null) return cached;
  if (!loading) {
    loading = AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        cached = value === 'true';
        return cached;
      })
      .catch(() => {
        cached = false;
        return false;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export async function setFaceBlurEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  cached = enabled;
  emit(enabled);
}

export function useFaceBlurSetting() {
  const [enabled, setEnabledState] = useState(cached ?? false);
  const [isLoading, setIsLoading] = useState(cached == null);

  useEffect(() => {
    let mounted = true;
    const listener = (next: boolean) => {
      if (mounted) setEnabledState(next);
    };
    listeners.add(listener);
    void getFaceBlurEnabled().then((next) => {
      if (!mounted) return;
      setEnabledState(next);
      setIsLoading(false);
    });
    return () => {
      mounted = false;
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback(async (next: boolean) => {
    setEnabledState(next);
    try {
      await setFaceBlurEnabled(next);
    } catch (error) {
      setEnabledState(!next);
      throw error;
    }
  }, []);

  return { enabled, isLoading, setEnabled: update };
}

export const __testing = {
  reset() {
    cached = null;
    loading = null;
    listeners.clear();
  },
  storageKey: STORAGE_KEY,
};
