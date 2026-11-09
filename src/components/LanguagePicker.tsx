import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLang, useT, type Lang } from '../lib/i18n';
import { COLORS } from '../lib/theme';
import { Button } from './Button';

const OPTIONS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '简体中文' },
];

export function LanguageList({ onSelect }: { onSelect: (lang: Lang) => void }) {
  const { lang } = useLang();
  return <View>
    {OPTIONS.map(option => {
      const active = option.code === lang;
      return (
        <Pressable
          key={option.code}
          onPress={() => onSelect(option.code)}
          accessibilityRole="radio"
          accessibilityState={{ checked: active }}
          accessibilityLabel={option.label}
          className="min-h-[56px] flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-ink-faint"
        >
          <Text className="flex-1 text-[20px] font-medium text-ink">{option.label}</Text>
          {active && <Ionicons name="checkmark" size={24} color={COLORS.ink} />}
        </Pressable>
      );
    })}
  </View>;
}

/**
 * Each language uses its own name so it remains recognizable even when the
 * current translation is unfamiliar. A scrollable list fits longer names.
 */
export function LanguagePicker() {
  const { lang, setLang } = useLang();
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = OPTIONS.find(option => option.code === lang)!;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t.about.languageTitle}: ${selected.label}`}
        accessibilityState={{ expanded: open }}
        className="min-h-[52px] flex-row items-center justify-between gap-3 rounded-full bg-ink-faint px-5 py-3 active:opacity-80"
      >
        <Text className="flex-1 text-[17px] font-semibold text-ink">{selected.label}</Text>
        <Ionicons name="chevron-down" size={22} color={COLORS.ink} />
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <SafeAreaView className="flex-1 bg-black/50">
          <ScrollView contentContainerClassName="grow items-center justify-center px-6 py-8" bounces={false}>
            <View accessibilityViewIsModal className="w-full max-w-[440px] rounded-2xl bg-white p-6">
              <Text accessibilityRole="header" className="mb-4 text-[24px] font-bold text-ink">
                {t.about.languageTitle}
              </Text>
              <LanguageList onSelect={language => { setLang(language); setOpen(false); }} />
              <View className="mt-4">
                <Button title={t.common.cancel} variant="secondary" onPress={() => setOpen(false)} />
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
