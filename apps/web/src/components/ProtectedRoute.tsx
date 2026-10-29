import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { UserRole } from '@campusbid/shared';
import { useAuth } from '../auth/AuthContext';

interface ProtectedRouteProps {
  children?: ReactNode;
  requiredRole?: UserRole;
}

export function ProtectedRoute({
  children,
  requiredRole,
}: ProtectedRouteProps) {
  const { user, roles, status, retryRestore } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-xl py-20 text-center" role="status">
        Checking your campus pass...
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="campus-card mx-auto my-12 max-w-xl rounded-3xl p-7 text-center">
        <h1 className="font-display text-3xl">
          We could not check your session
        </h1>
        <p className="mt-3 text-sm opacity-75">
          Check your connection and try again.
        </p>
        <button
          className="mt-6 rounded-full bg-ink px-5 py-3 font-semibold text-paper dark:bg-paper dark:text-ink"
          onClick={() => void retryRestore()}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (requiredRole && !roles.includes(requiredRole)) {
    return <Navigate to="/me" replace />;
  }

  return children ?? <Outlet />;
}
