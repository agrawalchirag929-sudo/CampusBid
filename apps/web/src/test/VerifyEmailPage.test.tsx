import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function emptyResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

describe('email verification link', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('removes the token from the URL and posts it once under StrictMode', async () => {
    const token = 'a'.repeat(43);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input) === '/api/auth/refresh'
          ? jsonResponse(401, { error: 'No refresh session' })
          : emptyResponse(204),
      );
    window.history.replaceState({}, '', '/verify-email?token=' + token);

    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <MemoryRouter initialEntries={['/verify-email?token=' + token]}>
              <Routes>
                <Route element={<VerifyEmailPage />} path="/verify-email" />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(window.location.search).toBe('');
    await waitFor(() =>
      expect(screen.getByText('You are verified')).toBeInTheDocument(),
    );
    const verificationCalls = fetchMock.mock.calls.filter(
      ([input]) => String(input) === '/api/auth/verify-email',
    );
    expect(verificationCalls).toHaveLength(1);
    expect(verificationCalls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(verificationCalls[0]?.[1]?.body).toBe(JSON.stringify({ token }));
    queryClient.clear();
  });
});
