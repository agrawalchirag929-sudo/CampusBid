import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeResponse } from '@campusbid/shared';
import { AuthProvider, SESSION_QUERY_KEY } from '../auth/AuthContext';
import { ProtectedRoute } from '../components/ProtectedRoute';

const user: MeResponse = {
  id: '64a000000000000000000001',
  email: 'student@bmsce.ac.in',
  collegeId: '64a000000000000000000002',
  roles: ['BUYER', 'SELLER'],
  status: 'active',
  emailVerifiedAt: '2026-10-20T08:00:00.000Z',
  name: 'A Campus Student',
  createdAt: '2026-10-18T08:00:00.000Z',
};

function renderRoutes(session: MeResponse | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(SESSION_QUERY_KEY, session);
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/me']}>
          <Routes>
            <Route
              element={
                <ProtectedRoute>
                  <h1>Private account page</h1>
                </ProtectedRoute>
              }
              path="/me"
            />
            <Route element={<h1>Sign-in page</h1>} path="/login" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

describe('ProtectedRoute', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('shows protected content for an authenticated user', () => {
    const { queryClient } = renderRoutes(user);
    expect(
      screen.getByRole('heading', { name: 'Private account page' }),
    ).toBeInTheDocument();
    queryClient.clear();
  });

  it('sends an anonymous user to sign in', async () => {
    const { queryClient } = renderRoutes(null);
    expect(
      await screen.findByRole('heading', { name: 'Sign-in page' }),
    ).toBeInTheDocument();
    queryClient.clear();
  });
});
