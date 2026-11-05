import type { ClientSession, Connection, Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { encryptMailPayload } from './crypto.js';
import { createMailOutboxModel, type MailOutboxFields } from './model.js';
import type { AuctionNotificationEmailPayload } from './types.js';

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

export class MailOutboxRepository {
  private readonly Outbox: Model<MailOutboxFields>;

  constructor(
    connection: Connection,
    private readonly encryptionSecret: string,
  ) {
    this.Outbox = createMailOutboxModel(connection);
  }

  async enqueueVerificationEmail(
    email: { to: string; name: string; token: string },
    identity: { userId: Types.ObjectId; collegeId: Types.ObjectId },
    session: ClientSession,
  ): Promise<void> {
    await new this.Outbox({
      kind: 'verification-email',
      dedupeKey: `verification:${randomUUID()}`,
      userId: identity.userId,
      collegeId: identity.collegeId,
      encryptedPayload: encryptMailPayload(
        { kind: 'verification-email', ...email },
        this.encryptionSecret,
      ),
      availableAt: new Date(),
      attempts: 0,
      lockedAt: null,
      deliveredAt: null,
    }).save({ session });
  }

  async enqueueAuctionNotificationEmail(
    email: AuctionNotificationEmailPayload,
    identity: { userId: Types.ObjectId; collegeId: Types.ObjectId },
    dedupeKey: string,
    session?: ClientSession,
  ): Promise<void> {
    try {
      await new this.Outbox({
        kind: email.kind,
        dedupeKey,
        userId: identity.userId,
        collegeId: identity.collegeId,
        encryptedPayload: encryptMailPayload(email, this.encryptionSecret),
        availableAt: new Date(),
        attempts: 0,
        lockedAt: null,
        deliveredAt: null,
      }).save(session ? { session } : undefined);
    } catch (error) {
      if (!session && isDuplicateKey(error)) return;
      throw error;
    }
  }
}
