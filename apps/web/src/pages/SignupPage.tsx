import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { signupSchema } from '@campusbid/shared';
import type { SignupInput } from '@campusbid/shared';
import { ApiClientError, signup } from '../lib/api';

const emptyForm: SignupInput = { name: '', email: '', password: '' };

export function SignupPage() {
  const [form, setForm] = useState<SignupInput>(emptyForm);
  const [errors, setErrors] = useState<string[]>([]);
  const [requestError, setRequestError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors([]);
    setRequestError('');
    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }

    setBusy(true);
    try {
      await signup(parsed.data);
      setSent(true);
    } catch (error) {
      setRequestError(
        error instanceof ApiClientError
          ? error.message
          : 'We could not send your request. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <section className="campus-card mx-auto max-w-xl rounded-[2rem] p-7 sm:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">
          Check your inbox
        </p>
        <h1 className="mt-4 font-display text-4xl font-bold">One quick step</h1>
        <p className="mt-4 leading-7 opacity-75">
          If this college address is eligible, check your email for a
          verification link. You can close this page while it makes its way to
          you.
        </p>
        <Link
          className="mt-7 inline-block font-bold text-moss underline dark:text-[#f0cd83]"
          to="/login"
        >
          Back to sign in
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
      <div className="px-1">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">
          Start with your college email
        </p>
        <h1 className="mt-4 max-w-md font-display text-5xl font-bold leading-[1.02] sm:text-6xl">
          Your campus,
          <br />
          your marketplace.
        </h1>
        <p className="mt-5 max-w-md leading-7 opacity-75">
          Create an account to buy and sell with verified students from your
          college.
        </p>
        <div className="mt-8 h-1 w-28 paper-rule" />
      </div>

      <form
        className="campus-card rounded-[2rem] p-6 sm:p-9"
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="font-display text-3xl font-bold">Create your account</h2>
        <p className="mt-2 text-sm opacity-70">
          Fields marked with * are required.
        </p>
        <div className="mt-7 space-y-5">
          <label className="block text-sm font-semibold" htmlFor="signup-name">
            Your name *
            <input
              autoComplete="name"
              className="form-input mt-2"
              id="signup-name"
              maxLength={100}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="How should we greet you?"
              required
              value={form.name}
            />
          </label>
          <label className="block text-sm font-semibold" htmlFor="signup-email">
            College email *
            <input
              autoComplete="email"
              className="form-input mt-2"
              id="signup-email"
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              placeholder="you@college.edu"
              required
              type="email"
              value={form.email}
            />
            <span className="mt-2 block text-xs font-normal opacity-65">
              Use the email address issued by your college.
            </span>
          </label>
          <label
            className="block text-sm font-semibold"
            htmlFor="signup-password"
          >
            Password *
            <input
              autoComplete="new-password"
              className="form-input mt-2"
              id="signup-password"
              maxLength={128}
              minLength={10}
              onChange={(event) =>
                setForm({ ...form, password: event.target.value })
              }
              placeholder="At least 10 characters"
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

        <button
          className="mt-7 w-full rounded-full bg-ink px-5 py-3 font-bold text-paper transition hover:bg-moss disabled:cursor-wait disabled:opacity-60 dark:bg-paper dark:text-ink"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Sending your request...' : 'Send verification link'}
        </button>
        <p className="mt-5 text-center text-sm opacity-75">
          Already have an account?{' '}
          <Link
            className="font-bold text-moss underline dark:text-[#f0cd83]"
            to="/login"
          >
            Sign in
          </Link>
        </p>
      </form>
    </section>
  );
}
