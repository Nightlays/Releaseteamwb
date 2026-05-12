export const STORAGE_REST_URL: string =
  (import.meta.env.VITE_STORAGE_REST_URL as string | undefined)?.replace(/\/$/, '') ||
  '/api/postgres/rest/v1';

export function storageHeaders(prefer?: string) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}
