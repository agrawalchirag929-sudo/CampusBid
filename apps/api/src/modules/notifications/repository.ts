import type { ClientSession, Connection, Model, Types } from 'mongoose';
import { encryptVerificationEmail } from './crypto.js';
import { createMailOutboxModel, type MailOutboxFields } from './model.js';

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
      userId: identity.userId,
      collegeId: identity.collegeId,
      encryptedPayload: encryptVerificationEmail(email, this.encryptionSecret),
      availableAt: new Date(),
      attempts: 0,
      lockedAt: null,
      deliveredAt: null,
    }).save({ session });
  }
}
