export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'EMAIL_DOMAIN_UNSUPPORTED'
  | 'INVALID_VERIFICATION_TOKEN'
  | 'INVALID_REFRESH_TOKEN';

const publicErrors: Record<AuthErrorCode, { status: number; message: string }> =
  {
    INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password' },
    EMAIL_NOT_VERIFIED: {
      status: 403,
      message: 'Verify your email before logging in',
    },
    EMAIL_DOMAIN_UNSUPPORTED: {
      status: 400,
      message: 'Email domain is not eligible for registration',
    },
    INVALID_VERIFICATION_TOKEN: {
      status: 400,
      message: 'Verification token is invalid or expired',
    },
    INVALID_REFRESH_TOKEN: {
      status: 401,
      message: 'Refresh session is invalid',
    },
  };

export class AuthServiceError extends Error {
  readonly status: number;
  constructor(readonly code: AuthErrorCode) {
    super(publicErrors[code].message);
    this.name = 'AuthServiceError';
    this.status = publicErrors[code].status;
  }
}

export function authErrorMessage(error: AuthServiceError): string {
  return publicErrors[error.code].message;
}
