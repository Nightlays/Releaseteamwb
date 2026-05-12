export const STORAGE_REST_URL = '/api/postgres/rest/v1';

export function storageHeaders(prefer?: string) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}
