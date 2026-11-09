import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, apiFetch } from './api';
import { withTimeout } from './connectivity';
import { fetchWithTransport, REQUEST_TIMEOUT_MS } from './transport';

export type AppAccess = { status: 'approved' | 'pending'; email?: string | null };
const key = (accountId: string) => `luche.app-access.approved.v1.${accountId}`;

export async function requestAppAccess(email: string): Promise<AppAccess> {
  const requestId = `access-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const path = '/app-access/request';
  const { response, release } = await fetchWithTransport(path, requestId, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  try {
    if (!response.ok) throw new ApiError(response.status, path, '', 'POST', requestId);
    const result = await withTimeout(response.json(), REQUEST_TIMEOUT_MS, 'read access response') as AppAccess;
    if (result.status !== 'approved' && result.status !== 'pending') throw new Error('invalid access response');
    return result;
  } finally { release(); }
}

export const fetchMyAppAccess = (accountId: string) => apiFetch<AppAccess>('/app-access/me', {}, accountId);
export const hasApprovedAppAccess = async (accountId: string) => (await AsyncStorage.getItem(key(accountId))) === 'approved';
export const rememberAppAccess = (accountId: string) => AsyncStorage.setItem(key(accountId), 'approved');
export const forgetAppAccess = (accountId: string) => AsyncStorage.removeItem(key(accountId));
