import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { en, type Dict } from './en';
import { es } from './es';
import { it } from './it';
import { ru } from './ru';
import { zh } from './zh';
import type { EvaluatedSide, TestConfig } from '../tests';

export type Lang = 'en' | 'es' | 'it' | 'ru' | 'zh';

const DICTS: Record<Lang, Dict> = { en, es, it, ru, zh };
const STORAGE_KEY = 'luche.lang.v1';

function isLanguage(value: string | null | undefined): value is Lang {
  return value != null && Object.prototype.hasOwnProperty.call(DICTS, value);
}

/** First supported language matching the device locale, else English. */
function deviceDefault(): Lang {
  const code = Localization.getLocales()[0]?.languageCode;
  return isLanguage(code) ? code : 'en';
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Dict;
  isLoaded: boolean;
  hasChosenLanguage: boolean;
};
const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Synchronous device default → no English flash. Stored override loads after.
  const [lang, setLangState] = useState<Lang>(deviceDefault);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasChosenLanguage, setHasChosenLanguage] = useState(false);
  const chosen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      if (!cancelled && !chosen.current && isLanguage(value)) {
        setLangState(value);
        setHasChosenLanguage(true);
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setIsLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const setLang = (l: Lang) => {
    chosen.current = true;
    setLangState(l);
    setHasChosenLanguage(true);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: DICTS[lang], isLoaded, hasChosenLanguage }}>
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

/** Current language, saved-choice readiness, and setter. */
export function useLang(): Omit<Ctx, 't'> {
  const { lang, setLang, isLoaded, hasChosenLanguage } = useCtx();
  return { lang, setLang, isLoaded, hasChosenLanguage };
}

/** Localized standalone label for an explicitly instructed hand or leg. */
export function formatEvaluatedSide(
  t: Dict,
  test: TestConfig,
  side: EvaluatedSide | undefined,
): string | undefined {
  if (!side || !test.sideLimb) return undefined;
  if (test.sideLimb === 'hand') {
    return side === 'left' ? t.instruction.leftHand : t.instruction.rightHand;
  }
  return side === 'left' ? t.instruction.leftLeg : t.instruction.rightLeg;
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
