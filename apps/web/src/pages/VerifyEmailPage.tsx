import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { verifyEmailSchema } from '@campusbid/shared';
import { ApiClientError, verifyEmail } from '../lib/api';

type VerificationStatus = 'checking' | 'success' | 'error' | 'missing';

const verificationRequests = new Map<string, Promise<void>>();

function verifyEmailOnce(token: string): Promise<void> {
  const existing = verificationRequests.get(token);
  if (existing) return existing;

  const request = verifyEmail({ token });
  verificationRequests.set(token, request);
  void request.then(
    () => {
      if (verificationRequests.get(token) === request) {
        verificationRequests.delete(token);
      }
    },
    () => {
      if (verificationRequests.get(token) === request) {
        verificationRequests.delete(token);
      }
    },
  );
  return request;
}

function removeTokenFromAddressBar(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('token');
  window.history.replaceState(
    window.history.state,
    '',
    url.pathname + url.search + url.hash,
  );
}

export function VerifyEmailPage() {
  const [token] = useState(() =>
    new URLSearchParams(window.location.search).get('token'),
  );
  const [status, setStatus] = useState<VerificationStatus>(
    token ? 'checking' : 'missing',
  );
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    removeTokenFromAddressBar();

    const parsed = verifyEmailSchema.safeParse({ token });
    if (!parsed.success) {
      setStatus('error');
      setErrorMessage('This verification link is invalid or expired.');
      return;
    }

    let mounted = true;
    void verifyEmailOnce(parsed.data.token).then(
      () => {
        if (mounted) setStatus('success');
      },
      (error: unknown) => {
        if (!mounted) return;
        setStatus('error');
        setErrorMessage(
          error instanceof ApiClientError
            ? error.message
            : 'We could not verify this link. Check your connection and try again.',
        );
      },
    );
    return () => {
      mounted = false;
    };
  }, [token]);

  return (
    <section className="campus-card mx-auto max-w-xl rounded-[2rem] p-7 sm:p-10">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-clay">
        Campus pass
      </p>
      {status === 'checking' ? (
        <>
          <h1 className="mt-4 font-display text-4xl font-bold">
            Checking your link
          </h1>
          <p className="mt-4 opacity-75" role="status">
            Confirming your email address...
          </p>
        </>
      ) : status === 'success' ? (
        <>
          <h1 className="mt-4 font-display text-4xl font-bold">
            You are verified
          </h1>
          <p className="mt-4 leading-7 opacity-75">
            Your campus account is ready. Sign in to see what is changing hands.
          </p>
          <Link
            className="mt-7 inline-block rounded-full bg-ink px-5 py-3 font-bold text-paper dark:bg-paper dark:text-ink"
            to="/login"
          >
            Continue to sign in
          </Link>
        </>
      ) : (
        <>
          <h1 className="mt-4 font-display text-4xl font-bold">
            {status === 'missing'
              ? 'Verification link missing'
              : 'Link not accepted'}
          </h1>
          <p className="mt-4 leading-7 text-clay" role="alert">
            {status === 'missing'
              ? 'Open the verification link from your email.'
              : errorMessage}
          </p>
          <Link
            className="mt-7 inline-block font-bold text-moss underline dark:text-[#f0cd83]"
            to="/signup"
          >
            Request another link
          </Link>
        </>
      )}
    </section>
  );
}
