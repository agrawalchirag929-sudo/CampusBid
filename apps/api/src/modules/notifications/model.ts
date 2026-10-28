import { Schema, type Connection, type Model } from 'mongoose';
import type { Types } from 'mongoose';

export interface MailOutboxFields {
  kind: 'verification-email';
  collegeId: Types.ObjectId;
  userId: Types.ObjectId;
  encryptedPayload: string | null;
  availableAt: Date;
  attempts: number;
  lockedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export const mailOutboxSchema = new Schema<MailOutboxFields>(
  {
    kind: { type: String, required: true, enum: ['verification-email'] },
    collegeId: { type: Schema.Types.ObjectId, required: true, ref: 'College' },
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    encryptedPayload: { type: String, default: null },
    availableAt: { type: Date, required: true },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    lockedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  { collection: 'mailOutbox', versionKey: false },
);

mailOutboxSchema.index(
  { deliveredAt: 1, availableAt: 1, lockedAt: 1, createdAt: 1 },
  { name: 'mail_outbox_dispatch' },
);
mailOutboxSchema.index(
  { collegeId: 1, userId: 1, createdAt: -1 },
  { name: 'mail_outbox_user_college' },
);
mailOutboxSchema.index(
  { deliveredAt: 1 },
  {
    expireAfterSeconds: 30 * 24 * 60 * 60,
    partialFilterExpression: { deliveredAt: { $type: 'date' } },
    name: 'mail_outbox_delivered_ttl',
  },
);

export function createMailOutboxModel(
  connection: Connection,
): Model<MailOutboxFields> {
  return (
    (connection.models.MailOutbox as Model<MailOutboxFields> | undefined) ??
    connection.model<MailOutboxFields>('MailOutbox', mailOutboxSchema)
  );
}
