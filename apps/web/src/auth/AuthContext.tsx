import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginInput, MeResponse, UserRole } from '@campusbid/shared';
import {
  clearAccessToken,
  getMe,
  login as loginRequest,
  logout as logoutRequest,
  restoreSession,
} from '../lib/api';

export const SESSION_QUERY_KEY = ['auth', 'me'] as const;

type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthContextValue {
  user: MeResponse | null;
  roles: UserRole[];
  status: AuthStatus;
  error: Error | null;
  login(input: LoginInput): Promise<void>;
  logout(): Promise<void>;
  retryRestore(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: restoreSession,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  const login = useCallback(
    async (input: LoginInput) => {
      await loginRequest(input);
      try {
        const user = await getMe();
        queryClient.setQueryData<MeResponse | null>(SESSION_QUERY_KEY, user);
      } catch (error) {
        clearAccessToken();
        throw error;
      }
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      clearAccessToken();
      queryClient.setQueryData<MeResponse | null>(SESSION_QUERY_KEY, null);
    }
  }, [queryClient]);

  const retryRestore = useCallback(async () => {
    await session.refetch();
  }, [session]);

  const user = session.data ?? null;
  const status: AuthStatus = session.isPending
    ? 'loading'
    : session.isError
      ? 'error'
      : user
        ? 'authenticated'
        : 'anonymous';

  const value: AuthContextValue = {
    user,
    roles: user?.roles ?? [],
    status,
    error: session.error,
    login,
    logout,
    retryRestore,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}
