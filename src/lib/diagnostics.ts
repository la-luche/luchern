import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DIAGNOSTICS_KEY = 'luche.diagnostics.v1';
const MAX_EVENTS = 200;

export interface DiagnosticEvent {
  at: string;
  event: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}

let writeTail: Promise<void> = Promise.resolve();

function cleanData(data: DiagnosticEvent['data']): DiagnosticEvent['data'] {
  if (!data) return undefined;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (/authorization|token|secret|password|email|signed.?url|video.?uri|response.?body/i.test(key)) {
        return [key, '[redacted]'];
      }
      if (typeof value !== 'string') return [key, value];
      const scrubbed = value
        .replace(/\/invites\/[^/\s?]+/gi, '/invites/[redacted]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/https?:\/\/\S+/gi, '[url]')
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]')
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token]');
      return [key, scrubbed.slice(0, 240)];
    }),
  );
}

/**
 * Append a small, privacy-conscious event to a bounded on-device support log.
 * Callers pass IDs/status codes only—never tokens, URLs, email, video, or
 * keypoints. Writes are serialized so concurrent upload callbacks cannot lose
 * one another.
 */
export function recordDiagnostic(event: string, data?: DiagnosticEvent['data']): void {
  const item: DiagnosticEvent = { at: new Date().toISOString(), event, data: cleanData(data) };
  if (__DEV__ && process.env.NODE_ENV !== 'test') console.info('[luche]', item);
  writeTail = writeTail
    .then(async () => {
      const raw = await AsyncStorage.getItem(DIAGNOSTICS_KEY);
      const existing = raw ? (JSON.parse(raw) as DiagnosticEvent[]) : [];
      await AsyncStorage.setItem(
        DIAGNOSTICS_KEY,
        JSON.stringify([...existing, item].slice(-MAX_EVENTS)),
      );
    })
    .catch(() => {});
}

export function diagnosticErrorData(error: unknown): Record<string, string | number> {
  if (!(error instanceof Error)) return { error: String(error).slice(0, 240) };
  const extra = error as Error & { status?: number; path?: string; requestId?: string };
  return {
    error: error.name,
    // Status/path/request id are enough for support, so do not persist an API
    // response body on device.
    ...(extra.status == null ? { message: error.message.slice(0, 240) } : {}),
    ...(extra.status != null ? { status: extra.status } : {}),
    ...(extra.path ? { path: extra.path } : {}),
    ...(extra.requestId ? { requestId: extra.requestId } : {}),
  };
}

export async function exportDiagnostics(): Promise<string> {
  await writeTail;
  const raw = await AsyncStorage.getItem(DIAGNOSTICS_KEY);
  const events = raw ? (JSON.parse(raw) as DiagnosticEvent[]) : [];
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'Luche',
      build: {
        version: Constants.expoConfig?.version ?? 'unknown',
        sdkVersion: Constants.expoConfig?.sdkVersion ?? 'unknown',
        platform: Platform.OS,
      },
      events,
    },
    null,
    2,
  );
}
