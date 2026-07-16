import { useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Minimal transient toast — a module-level store + a host mounted once at the
 * root. Used for brief confirmations ("Saved") so a non-technical user gets
 * clear feedback that an action registered. No queue: a new toast replaces the
 * current one.
 */
type Toast = { id: number; message: string } | null;

let current: Toast = null;
let counter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function showToast(message: string, ms = 2200) {
  counter += 1;
  current = { id: counter, message };
  emit();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    timer = null;
    emit();
  }, ms);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return current;
}

export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!toast) return null;
  return (
    <SafeAreaView
      pointerEvents="none"
      edges={['bottom']}
      className="absolute inset-x-0 bottom-0 items-center"
    >
      <View className="mb-6 max-w-[88%] rounded-2xl bg-ink px-4 py-3">
        <Text className="text-center text-[15px] font-semibold text-white">{toast.message}</Text>
      </View>
    </SafeAreaView>
  );
}
