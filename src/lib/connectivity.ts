import { Alert } from 'react-native';

import type { Dict } from './i18n/en';

/** A UI-owned deadline for SDK calls that do not accept an AbortSignal. */
export class OperationTimeoutError extends Error {
  constructor(public readonly operation: string) {
    super(`${operation} timed out`);
    this.name = 'OperationTimeoutError';
  }
}

export function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  name: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OperationTimeoutError(name)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function clerkErrorCodes(error: unknown): string[] {
  if (!error || typeof error !== 'object') return [];
  const value = error as {
    code?: unknown;
    errors?: Array<{ code?: unknown }>;
  };
  return [
    typeof value.code === 'string' ? value.code : null,
    ...(value.errors ?? []).map((item) =>
      typeof item?.code === 'string' ? item.code : null,
    ),
  ].filter((code): code is string => Boolean(code));
}

/** The only Clerk failure that means the email should enter sign-up. */
export function isMissingClerkAccount(error: unknown): boolean {
  return clerkErrorCodes(error).includes('form_identifier_not_found');
}

/** Transport failures from our API, Clerk, or an SDK call deadline. */
export function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: unknown; message?: unknown };
  if (
    value.name === 'ApiNetworkError'
    || value.name === 'ApiTimeoutError'
    || value.name === 'OperationTimeoutError'
  ) {
    return true;
  }
  if (clerkErrorCodes(error).includes('network_error')) return true;
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
  return (
    message.includes('network request failed')
    || message.includes('failed to fetch')
    || message.includes('internet connection appears to be offline')
  );
}

/** Native, localized recovery prompt used after a bounded request fails. */
export function showConnectionAlert(
  t: Dict,
  onRetry: () => void,
  offline = false,
): void {
  Alert.alert(
    offline ? t.connection.offlineTitle : t.connection.problemTitle,
    offline ? t.connection.offlineBody : t.connection.problemBody,
    [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.connection.tryAgain, onPress: onRetry },
    ],
  );
}
