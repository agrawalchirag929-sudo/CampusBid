import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, getMe, setAccessToken } from '../lib/api';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const meResponse = {
  id: '64a000000000000000000001',
  email: 'student@bmsce.ac.in',
  collegeId: '64a000000000000000000002',
  roles: ['BUYER', 'SELLER'],
  status: 'active',
  emailVerifiedAt: '2026-10-20T08:00:00.000Z',
  name: 'A Campus Student',
  createdAt: '2026-10-18T08:00:00.000Z',
};

describe('API client access-token refresh', () => {
  afterEach(() => {
    clearAccessToken();
  });

  it('shares one refresh between parallel 401 responses and retries once', async () => {
    setAccessToken('expired-access-token');
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/auth/refresh') {
        return jsonResponse(200, {
          accessToken: 'fresh-access-token',
          tokenType: 'Bearer',
          expiresIn: 900,
        });
      }
      const authorization = new Headers(init?.headers).get('Authorization');
      if (authorization === 'Bearer expired-access-token') {
        return jsonResponse(401, { error: 'Expired access token' });
      }
      return jsonResponse(200, meResponse);
    });

    const results = await Promise.all([getMe(), getMe()]);

    expect(results).toHaveLength(2);
    expect(
      calls.filter((call) => call.url === '/api/auth/refresh'),
    ).toHaveLength(1);
    expect(calls.filter((call) => call.url === '/api/me')).toHaveLength(4);
    expect(
      calls
        .filter((call) => call.url === '/api/me')
        .every((call) => call.init?.credentials === 'include'),
    ).toBe(true);
    expect(
      calls.filter(
        (call) =>
          call.url === '/api/me' &&
          new Headers(call.init?.headers).get('Authorization') ===
            'Bearer fresh-access-token',
      ),
    ).toHaveLength(2);
  });
});
