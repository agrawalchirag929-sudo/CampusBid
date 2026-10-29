import {
  apiErrorResponseSchema,
  authSessionResponseSchema,
  loginSchema,
  meResponseSchema,
  messageResponseSchema,
  resendVerificationSchema,
  signupSchema,
  verifyEmailSchema,
} from '@campusbid/shared';
import type {
  AuthSessionResponse,
  LoginInput,
  MeResponse,
  MessageResponse,
  ResendVerificationInput,
  SignupInput,
  VerifyEmailInput,
} from '@campusbid/shared';

const API_BASE_URL = '/api';

type ResponseSchema<T> = {
  parse(input: unknown): T;
};

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: HeadersInit;
  retryUnauthorized?: boolean;
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let restoreInFlight: Promise<MeResponse | null> | null = null;

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/auth/');
}

async function apiError(response: Response): Promise<ApiClientError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    body = null;
  }
  const parsed = apiErrorResponseSchema.safeParse(body);
  return new ApiClientError(
    response.status,
    parsed.success ? parsed.data.error : 'The request could not be completed.',
  );
}

async function rawRequest(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', 'Bearer ' + accessToken);
  }
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  return fetch(API_BASE_URL + path, init);
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  const current = (async () => {
    const response = await fetch(API_BASE_URL + '/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      clearAccessToken();
      if (response.status === 401) return null;
      throw await apiError(response);
    }
    const payload: unknown = await response.json();
    const session = authSessionResponseSchema.parse(payload);
    setAccessToken(session.accessToken);
    return session.accessToken;
  })();

  refreshInFlight = current.finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function requestJson<T>(
  path: string,
  schema: ResponseSchema<T>,
  options: RequestOptions = {},
): Promise<T> {
  let response = await rawRequest(path, options);
  if (
    response.status === 401 &&
    options.retryUnauthorized !== false &&
    !isAuthPath(path)
  ) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await rawRequest(path, {
        ...options,
        retryUnauthorized: false,
      });
    }
  }
  if (!response.ok) throw await apiError(response);
  const payload: unknown = await response.json();
  return schema.parse(payload);
}

async function requestNoContent(
  path: string,
  options: RequestOptions = {},
): Promise<void> {
  const response = await rawRequest(path, options);
  if (!response.ok) throw await apiError(response);
}

export function signup(input: SignupInput): Promise<MessageResponse> {
  const parsed = signupSchema.parse(input);
  return requestJson('/auth/signup', messageResponseSchema, {
    method: 'POST',
    body: parsed,
    retryUnauthorized: false,
  });
}

export async function verifyEmail(input: VerifyEmailInput): Promise<void> {
  const parsed = verifyEmailSchema.parse(input);
  await requestNoContent('/auth/verify-email', {
    method: 'POST',
    body: parsed,
  });
}

export async function login(input: LoginInput): Promise<AuthSessionResponse> {
  const parsed = loginSchema.parse(input);
  const session = await requestJson('/auth/login', authSessionResponseSchema, {
    method: 'POST',
    body: parsed,
    retryUnauthorized: false,
  });
  setAccessToken(session.accessToken);
  return session;
}

export function resendVerification(
  input: ResendVerificationInput,
): Promise<MessageResponse> {
  const parsed = resendVerificationSchema.parse(input);
  return requestJson('/auth/resend-verification', messageResponseSchema, {
    method: 'POST',
    body: parsed,
    retryUnauthorized: false,
  });
}

export function getMe(): Promise<MeResponse> {
  return requestJson('/me', meResponseSchema);
}

export async function logout(): Promise<void> {
  try {
    await requestNoContent('/auth/logout', { method: 'POST' });
  } finally {
    clearAccessToken();
  }
}

export function restoreSession(): Promise<MeResponse | null> {
  if (restoreInFlight) return restoreInFlight;

  const current = (async () => {
    const token = await refreshAccessToken();
    if (!token) return null;
    try {
      return await getMe();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) return null;
      throw error;
    }
  })();

  restoreInFlight = current.finally(() => {
    restoreInFlight = null;
  });
  return restoreInFlight;
}
