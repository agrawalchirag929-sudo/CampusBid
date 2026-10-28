import { Schema, type Connection, type Model } from 'mongoose';
import type { Types } from 'mongoose';
import {
  USER_ROLES,
  USER_STATUSES,
  type UserRole,
  type UserStatus,
} from '@campusbid/shared';

export interface UserFields {
  email: string;
  passwordHash: string;
  collegeId: Types.ObjectId;
  roles: UserRole[];
  status: UserStatus;
  emailVerifiedAt: Date | null;
  name: string;
  createdAt: Date;
}

export const userSchema = new Schema<UserFields>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 320,
    },
    passwordHash: { type: String, required: true, select: false },
    collegeId: { type: Schema.Types.ObjectId, required: true, ref: 'College' },
    roles: {
      type: [{ type: String, enum: USER_ROLES }],
      required: true,
      default: [],
    },
    status: {
      type: String,
      enum: USER_STATUSES,
      required: true,
      default: 'active',
    },
    emailVerifiedAt: { type: Date, default: null },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  { collection: 'users', versionKey: false },
);

userSchema.index({ email: 1 }, { unique: true, name: 'user_email_unique' });
userSchema.index(
  { collegeId: 1, status: 1, createdAt: -1 },
  { name: 'user_college_status_createdAt' },
);

export function createUserModel(connection: Connection): Model<UserFields> {
  return (
    (connection.models.User as Model<UserFields> | undefined) ??
    connection.model<UserFields>('User', userSchema)
  );
}
