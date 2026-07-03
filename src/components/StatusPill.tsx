import { ActivityIndicator, Text, View } from 'react-native';

import type { RecordingStatus } from '../lib/types';

const CONFIG: Record<RecordingStatus, { label: string; bg: string; fg: string; spin: boolean }> = {
  uploading: { label: 'Uploading…', bg: 'bg-blue-100', fg: 'text-blue-700', spin: true },
  processing: { label: 'Processing…', bg: 'bg-amber-100', fg: 'text-amber-700', spin: true },
  done: { label: 'Done', bg: 'bg-emerald-100', fg: 'text-emerald-700', spin: false },
  failed: { label: 'Failed', bg: 'bg-red-100', fg: 'text-red-700', spin: false },
};

/** Small colored status chip on each recording card. */
export function StatusPill({ status }: { status: RecordingStatus }) {
  const c = CONFIG[status];
  return (
    <View className={`flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1 ${c.bg}`}>
      {c.spin && <ActivityIndicator size="small" color="#9ca3af" />}
      <Text className={`text-[12px] font-semibold ${c.fg}`}>{c.label}</Text>
    </View>
  );
}
