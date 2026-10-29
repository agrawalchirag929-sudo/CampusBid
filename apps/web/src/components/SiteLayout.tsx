import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';

type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  const saved = window.localStorage.getItem('campusbid-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function SiteLayout() {
  const { user, roles, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [logoutNotice, setLogoutNotice] = useState('');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem('campusbid-theme', theme);
  }, [theme]);

  useEffect(() => {
    setLogoutNotice('');
  }, [location.pathname]);

  const handleLogout = async () => {
    setLogoutNotice('');
    try {
      await logout();
      navigate('/');
    } catch {
      setLogoutNotice(
        'You are signed out here, but the server could not confirm logout.',
      );
    }
  };

  return (
    <div className="site-grid min-h-screen bg-paper text-ink transition-colors dark:bg-[#14231f] dark:text-[#ece8dc]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 sm:px-7">
        <header className="flex items-center justify-between gap-3 border-b border-ink/15 py-4 dark:border-paper/15">
          <Link
            aria-label="CampusBid home"
            className="flex items-center gap-3"
            to="/"
          >
            <span className="grid size-11 place-items-center rounded-t-2xl rounded-b-md border-2 border-ink bg-moss text-sm font-black tracking-tight text-paper dark:border-paper dark:bg-[#284c40]">
              CB
            </span>
            <span>
              <span className="block font-display text-xl font-bold leading-none sm:text-2xl">
                CampusBid
              </span>
              <span className="mt-1 hidden text-[0.62rem] font-bold uppercase tracking-[0.18em] opacity-60 sm:block">
                A fair start for good finds
              </span>
            </span>
          </Link>

          <nav
            aria-label="Main navigation"
            className="flex items-center gap-2 sm:gap-5"
          >
            <Link
              className="hidden text-sm font-semibold hover:text-clay sm:inline"
              to="/"
            >
              Auctions
            </Link>
            {user ? (
              <>
                {roles.includes('SELLER') && (
                  <Link
                    className="hidden text-sm font-semibold hover:text-clay sm:inline"
                    to="/me#selling"
                  >
                    Seller desk
                  </Link>
                )}
                {roles.includes('ADMIN') && (
                  <Link
                    className="hidden text-sm font-semibold hover:text-clay sm:inline"
                    to="/me#roles"
                  >
                    Admin
                  </Link>
                )}
                <Link
                  className="rounded-full border border-ink/20 px-3 py-2 text-sm font-semibold hover:bg-ink/5 dark:border-paper/20 dark:hover:bg-paper/10"
                  to="/me"
                >
                  My account
                </Link>
                <button
                  className="hidden text-sm font-semibold opacity-75 hover:opacity-100 sm:inline"
                  onClick={() => void handleLogout()}
                  type="button"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  className="hidden text-sm font-semibold hover:text-clay sm:inline"
                  to="/login"
                >
                  Sign in
                </Link>
                <Link
                  className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-paper shadow-sm hover:bg-moss dark:bg-paper dark:text-ink"
                  to="/signup"
                >
                  Join campus
                </Link>
              </>
            )}
            <button
              aria-label={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              className="grid size-10 place-items-center rounded-full border border-ink/20 text-lg hover:bg-ink/5 dark:border-paper/20 dark:hover:bg-paper/10"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              type="button"
            >
              <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
            </button>
          </nav>
        </header>

        {logoutNotice && (
          <p
            className="mt-3 rounded-xl border border-clay/30 bg-clay/10 px-4 py-3 text-sm"
            role="alert"
          >
            {logoutNotice}
          </p>
        )}

        <main className="flex-1 py-8 sm:py-12">
          <Outlet />
        </main>

        <footer className="flex flex-col gap-3 border-t border-ink/15 py-6 text-xs opacity-70 dark:border-paper/15 sm:flex-row sm:items-center sm:justify-between">
          <span>Built for campus communities. Designed for trust.</span>
          <span className="font-semibold uppercase tracking-[0.16em]">
            BMSCE and beyond
          </span>
        </footer>
      </div>
    </div>
  );
}
