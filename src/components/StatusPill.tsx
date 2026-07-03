import { ActivityIndicator, Text, View } from 'react-native';

import { useT } from '../lib/i18n';
import type { RecordingStatus } from '../lib/types';

const STYLE: Record<RecordingStatus, { bg: string; fg: string; spin: boolean }> = {
  uploading: { bg: 'bg-blue-100', fg: 'text-blue-700', spin: true },
  processing: { bg: 'bg-amber-100', fg: 'text-amber-700', spin: true },
  done: { bg: 'bg-emerald-100', fg: 'text-emerald-700', spin: false },
  failed: { bg: 'bg-red-100', fg: 'text-red-700', spin: false },
};

/** Small colored status chip on each recording card. */
export function StatusPill({ status }: { status: RecordingStatus }) {
  const t = useT();
  const c = STYLE[status];
  return (
    <View className={`flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1 ${c.bg}`}>
      {c.spin && <ActivityIndicator size="small" color="#9ca3af" />}
      <Text className={`text-[12px] font-semibold ${c.fg}`}>{t.status[status]}</Text>
    </View>
  );
}
