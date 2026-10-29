import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { loginSchema, resendVerificationSchema } from '@campusbid/shared';
import type { LoginInput } from '@campusbid/shared';
import { useAuth } from '../auth/AuthContext';
import { ApiClientError, resendVerification } from '../lib/api';

const emptyForm: LoginInput = { email: '', password: '' };

export function LoginPage() {
  const { login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState<LoginInput>(emptyForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [requestError, setRequestError] = useState('');
  const [unverified, setUnverified] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [resendError, setResendError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors([]);
    setRequestError('');
    setUnverified(false);
    setResendMessage('');
    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }

    setBusy(true);
    try {
      await login(parsed.data);
      const state = location.state as { from?: { pathname?: unknown } } | null;
      const destination = state?.from?.pathname;
      navigate(
        typeof destination === 'string' &&
          destination.startsWith('/') &&
          !destination.startsWith('//')
          ? destination
          : '/me',
        { replace: true },
      );
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 403) {
        setUnverified(true);
      } else {
        setRequestError(
          error instanceof ApiClientError
            ? error.message
            : 'We could not sign you in. Check your connection and try again.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResendError('');
    setResendMessage('');
    const parsed = resendVerificationSchema.safeParse({ email: form.email });
    if (!parsed.success) {
      setResendError(
        'Enter a valid email address before requesting a new link.',
      );
      return;
    }
    setResending(true);
    try {
      const response = await resendVerification(parsed.data);
      setResendMessage(response.message);
    } catch (error) {
      setResendError(
        error instanceof ApiClientError
          ? error.message
          : 'We could not resend the link. Try again in a moment.',
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <section className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
      <div className="px-1">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">
          Welcome back
        </p>
        <h1 className="mt-4 max-w-md font-display text-5xl font-bold leading-[1.02] sm:text-6xl">
          Your next good find is close.
        </h1>
        <p className="mt-5 max-w-md leading-7 opacity-75">
          Sign in with the email you used to join your campus community.
        </p>
        <div className="mt-8 h-1 w-28 paper-rule" />
      </div>

      <form
        className="campus-card rounded-[2rem] p-6 sm:p-9"
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="font-display text-3xl font-bold">Sign in</h2>
        <div className="mt-7 space-y-5">
          <label className="block text-sm font-semibold" htmlFor="login-email">
            College email
            <input
              autoComplete="email"
              className="form-input mt-2"
              id="login-email"
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              placeholder="you@college.edu"
              required
              type="email"
              value={form.email}
            />
          </label>
          <label
            className="block text-sm font-semibold"
            htmlFor="login-password"
          >
            Password
            <input
              autoComplete="current-password"
              className="form-input mt-2"
              id="login-password"
              maxLength={128}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
              placeholder="Your password"
              required
              type="password"
              value={form.password}
            />
          </label>
        </div>

        {errors.length > 0 && (
          <ul
            className="mt-5 space-y-1 rounded-xl bg-clay/10 p-3 text-sm text-clay"
            role="alert"
          >
            {errors.map((error, index) => (
              <li key={String(index)}>{error}</li>
            ))}
          </ul>
        )}
        {requestError && (
          <p
            className="mt-5 rounded-xl bg-clay/10 p-3 text-sm text-clay"
            role="alert"
          >
            {requestError}
          </p>
        )}
        {unverified && (
          <div className="mt-5 rounded-2xl border border-saffron/50 bg-saffron/10 p-4">
            <p className="font-semibold">
              Verify your email before signing in.
            </p>
            <p className="mt-1 text-sm opacity-75">
              We can send a fresh link to the address above.
            </p>
            <button
              className="mt-3 rounded-full border border-ink/25 px-4 py-2 text-sm font-bold hover:bg-ink/5 dark:border-paper/25 dark:hover:bg-paper/10"
              disabled={resending}
              onClick={() => void resend()}
              type="button"
            >
              {resending ? 'Sending...' : 'Resend verification email'}
            </button>
            {resendMessage && (
              <p className="mt-3 text-sm" role="status">
                {resendMessage}
              </p>
            )}
            {resendError && (
              <p className="mt-3 text-sm text-clay" role="alert">
                {resendError}
              </p>
            )}
          </div>
        )}

        <button
          className="mt-7 w-full rounded-full bg-ink px-5 py-3 font-bold text-paper transition hover:bg-moss disabled:cursor-wait disabled:opacity-60 dark:bg-paper dark:text-ink"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Opening your account...' : 'Sign in'}
        </button>
        <p className="mt-5 text-center text-sm opacity-75">
          New here?{' '}
          <Link
            className="font-bold text-moss underline dark:text-[#f0cd83]"
            to="/signup"
          >
            Create an account
          </Link>
        </p>
      </form>
    </section>
  );
}
