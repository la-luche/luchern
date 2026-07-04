import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Text, View } from 'react-native';

import { useT } from '../lib/i18n';
import type { RecordingStatus } from '../lib/types';

type IconName = keyof typeof Ionicons.glyphMap;

// Each finished state also carries a glyph so status is legible without relying
// on colour alone (accessibility pass); in-progress states keep the spinner.
const STYLE: Record<
  RecordingStatus,
  { bg: string; fg: string; spin: boolean; icon?: IconName; iconColor?: string }
> = {
  uploading: { bg: 'bg-blue-100', fg: 'text-blue-700', spin: true },
  processing: { bg: 'bg-amber-100', fg: 'text-amber-700', spin: true },
  done: { bg: 'bg-emerald-100', fg: 'text-emerald-700', spin: false, icon: 'checkmark-circle', iconColor: '#047857' },
  failed: { bg: 'bg-red-100', fg: 'text-red-700', spin: false, icon: 'close-circle', iconColor: '#b91c1c' },
};

/** Small status chip on each recording card — colour + glyph + label. */
export function StatusPill({ status }: { status: RecordingStatus }) {
  const t = useT();
  const c = STYLE[status];
  return (
    <View className={`flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1 ${c.bg}`}>
      {c.spin && <ActivityIndicator size="small" color="#9ca3af" />}
      {c.icon && <Ionicons name={c.icon} size={14} color={c.iconColor} />}
      <Text className={`text-[14px] font-semibold ${c.fg}`}>{t.status[status]}</Text>
    </View>
  );
}
