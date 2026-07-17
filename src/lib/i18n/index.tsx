import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { en, type Dict } from './en';
import { it } from './it';
import { ru } from './ru';

export type Lang = 'en' | 'it' | 'ru';

const DICTS: Record<Lang, Dict> = { en, it, ru };
const STORAGE_KEY = 'luche.lang.v1';

/** First supported language matching the device locale, else English. */
function deviceDefault(): Lang {
  const code = Localization.getLocales()[0]?.languageCode;
  return code === 'it' || code === 'ru' ? code : 'en';
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: Dict };
const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Synchronous device default → no English flash. Stored override loads after.
  const [lang, setLangState] = useState<Lang>(deviceDefault);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'en' || v === 'it' || v === 'ru') setLangState(v);
    });
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: DICTS[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

function useCtx(): Ctx {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useT/useLang must be used within LanguageProvider');
  return ctx;
}

/** The active dictionary. Access copy as `t.section.key`. */
export function useT(): Dict {
  return useCtx().t;
}

/** Current language + setter (for the switcher). */
export function useLang(): { lang: Lang; setLang: (l: Lang) => void } {
  const { lang, setLang } = useCtx();
  return { lang, setLang };
}

const SEVERITY_MAP: Record<string, keyof Dict['severity']> = {
  Normal: 'normal',
  Slight: 'slight',
  Mild: 'mild',
  Moderate: 'moderate',
  Severe: 'severe',
};

/**
 * Localize a severity word ("Mild") coming from the server or the local
 * heuristic fallback — both emit the same five English words. Unrecognized
 * labels pass through unchanged.
 */
export function localizeSeverity(t: Dict, label: string): string {
  const k = SEVERITY_MAP[label];
  return k ? t.severity[k] : label;
}

/** Convert a backend quality code into readable diagnostic copy while keeping
 * its full meaning available for new codes the client has not seen before. */
export function formatAnalysisFailureReason(reason: string): string {
  const readable = reason
    .trim()
    .replace(/[:_]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!readable) return reason;
  return `${readable.charAt(0).toUpperCase()}${readable.slice(1)}.`;
}
