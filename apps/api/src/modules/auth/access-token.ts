import { jwtVerify } from 'jose';
import { Types } from 'mongoose';
import type { AppConfig } from '../../config.js';

export interface VerifiedAccessToken {
  userId: string;
  collegeId: string;
  expiresAt: Date;
}

export async function verifyAccessToken(
  token: string,
  config: AppConfig,
): Promise<VerifiedAccessToken | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(config.JWT_SECRET),
      {
        algorithms: ['HS256'],
        issuer: 'campusbid-api',
        audience: 'campusbid-client',
      },
    );
    if (
      typeof payload.sub !== 'string' ||
      !Types.ObjectId.isValid(payload.sub) ||
      typeof payload.collegeId !== 'string' ||
      !Types.ObjectId.isValid(payload.collegeId) ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp)
    ) {
      return null;
    }
    return {
      userId: payload.sub,
      collegeId: payload.collegeId,
      expiresAt: new Date(payload.exp * 1_000),
    };
  } catch {
    return null;
  }
}
