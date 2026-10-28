import { Schema, type Connection, type Model } from 'mongoose';
import type { Types } from 'mongoose';
import {
  createMailOutboxModel,
  type MailOutboxFields,
} from '../notifications/model.js';

export interface VerificationTokenFields {
  tokenHash: string;
  userId: Types.ObjectId;
  collegeId: Types.ObjectId;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface RefreshTokenFields {
  tokenHash: string;
  userId: Types.ObjectId;
  collegeId: Types.ObjectId;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export const verificationTokenSchema = new Schema<VerificationTokenFields>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    collegeId: { type: Schema.Types.ObjectId, required: true, ref: 'College' },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  { collection: 'verificationTokens', versionKey: false },
);
verificationTokenSchema.index(
  { tokenHash: 1 },
  { unique: true, name: 'verification_token_hash_unique' },
);
verificationTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'verification_token_ttl' },
);
verificationTokenSchema.index(
  { collegeId: 1, userId: 1 },
  { name: 'verification_user_college' },
);

export const refreshTokenSchema = new Schema<RefreshTokenFields>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    collegeId: { type: Schema.Types.ObjectId, required: true, ref: 'College' },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  { collection: 'refreshTokens', versionKey: false },
);
refreshTokenSchema.index(
  { tokenHash: 1 },
  { unique: true, name: 'refresh_token_hash_unique' },
);
refreshTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'refresh_token_ttl' },
);
refreshTokenSchema.index(
  { collegeId: 1, userId: 1, familyId: 1 },
  { name: 'refresh_user_family_college' },
);
refreshTokenSchema.index(
  { familyId: 1, revokedAt: 1 },
  { name: 'refresh_family_revocation' },
);

export interface AuthModels {
  VerificationToken: Model<VerificationTokenFields>;
  RefreshToken: Model<RefreshTokenFields>;
  MailOutbox: Model<MailOutboxFields>;
}

export function createAuthModels(connection: Connection): AuthModels {
  const VerificationToken =
    (connection.models.VerificationToken as
      Model<VerificationTokenFields> | undefined) ??
    connection.model<VerificationTokenFields>(
      'VerificationToken',
      verificationTokenSchema,
    );
  const RefreshToken =
    (connection.models.RefreshToken as Model<RefreshTokenFields> | undefined) ??
    connection.model<RefreshTokenFields>('RefreshToken', refreshTokenSchema);
  const MailOutbox = createMailOutboxModel(connection);
  return { VerificationToken, RefreshToken, MailOutbox };
}
