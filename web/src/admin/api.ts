export type Role = 'superuser' | 'viewer';
export type AdminUser = { login: string; role: Role };
export type ApiErrorBody = { error: string; hint?: string; column?: string };

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

const BASE = '/api/admin';
let unauthorizedHandler: () => void = () => {};

// AdminApp sets this so that a 401 from any call leads to the login page.
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

async function request<T>(method: string, path: string, query?: URLSearchParams, body?: unknown) {
  const search = query?.toString();
  const res = await fetch(search ? `${BASE}${path}?${search}` : `${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({ error: `http_${res.status}` }))) as unknown;
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') unauthorizedHandler();
    throw new ApiError(res.status, data as ApiErrorBody);
  }
  return data as T;
}

export function apiGet<T>(path: string, query?: URLSearchParams): Promise<T> {
  return request<T>('GET', path, query);
}

// Every write sends JSON, also when there is no data: the server requires application/json.
export function apiSend<T>(
  method: 'POST' | 'DELETE',
  path: string,
  body: unknown = {},
): Promise<T> {
  return request<T>(method, path, undefined, body);
}
