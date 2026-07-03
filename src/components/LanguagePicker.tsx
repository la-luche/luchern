import { Pressable, Text, View } from 'react-native';

import { useLang, type Lang } from '../lib/i18n';

const OPTIONS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italiano' },
  { code: 'ru', label: 'Русский' },
];

/**
 * Segmented EN / IT / RU control. Labels are shown in their own language
 * (endonyms) so they're recognizable regardless of the current UI language.
 */
export function LanguagePicker() {
  const { lang, setLang } = useLang();
  return (
    <View className="flex-row rounded-full bg-ink-faint p-1">
      {OPTIONS.map((o) => {
        const active = o.code === lang;
        return (
          <Pressable
            key={o.code}
            onPress={() => setLang(o.code)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            className={`flex-1 items-center rounded-full py-2 ${active ? 'bg-ink' : ''} active:opacity-80`}
          >
            <Text className={`text-[14px] font-semibold ${active ? 'text-white' : 'text-ink'}`}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
