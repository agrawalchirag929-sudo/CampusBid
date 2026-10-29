import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth/AuthContext';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function SessionStatus() {
  const { status } = useAuth();
  return <p>{status}</p>;
}

describe('session restoration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends one refresh request when StrictMode replays the startup effect', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(401, { error: 'No refresh session' }));

    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SessionStatus />
          </AuthProvider>
        </QueryClientProvider>
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByText('anonymous')).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/refresh');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    queryClient.clear();
  });
});
