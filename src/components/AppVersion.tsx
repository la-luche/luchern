import { Text } from 'react-native';

import { getAppVersion } from '../lib/appVersion';
import { useT } from '../lib/i18n';

export function AppVersion() {
  const t = useT();
  const { version, buildNumber } = getAppVersion();
  return (
    <Text selectable className="mt-4 text-[15px] leading-6 text-ink-muted">
      {t.about.versionTitle} {version ?? '—'} ({t.about.buildTitle} {buildNumber ?? '—'})
    </Text>
  );
}
