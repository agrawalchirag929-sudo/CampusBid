import type { Model, Types } from 'mongoose';
import type { MailProvider } from '../auth/mail-provider.js';
import { decryptVerificationEmail } from './crypto.js';
import type { MailOutboxFields } from './model.js';

const LOCK_LEASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export interface MailWorkerLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

export class MailOutboxWorker {
  constructor(
    private readonly outbox: Model<MailOutboxFields>,
    private readonly provider: MailProvider,
    private readonly encryptionSecret: string,
    private readonly logger: MailWorkerLogger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async processBatch(batchSize = 25): Promise<number> {
    let processed = 0;
    for (let index = 0; index < batchSize; index += 1) {
      const claimed = await this.processOne();
      if (!claimed) break;
      processed += 1;
    }
    return processed;
  }

  private async processOne(): Promise<boolean> {
    const now = this.clock();
    const leaseExpiredAt = new Date(now.getTime() - LOCK_LEASE_MS);
    const job = await this.outbox
      .findOneAndUpdate(
        {
          deliveredAt: null,
          availableAt: { $lte: now },
          $or: [{ lockedAt: null }, { lockedAt: { $lte: leaseExpiredAt } }],
        },
        { $set: { lockedAt: now }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' },
      )
      .exec();
    if (!job) return false;

    try {
      if (!job.encryptedPayload) {
        throw new Error('Mail outbox payload is missing');
      }
      const message = decryptVerificationEmail(
        job.encryptedPayload,
        this.encryptionSecret,
      );
      await this.provider.sendVerificationEmail(message);
      await this.outbox
        .updateOne(this.claimFilter(job), {
          $set: {
            deliveredAt: this.clock(),
            encryptedPayload: null,
            lockedAt: null,
          },
        })
        .exec();
    } catch (error) {
      const retryDelay = Math.min(
        1_000 * 2 ** Math.min(Math.max(job.attempts - 1, 0), 20),
        MAX_RETRY_DELAY_MS,
      );
      await this.outbox
        .updateOne(this.claimFilter(job), {
          $set: {
            availableAt: new Date(this.clock().getTime() + retryDelay),
            lockedAt: null,
          },
        })
        .exec();
      this.logger.error(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          jobId: job._id.toString(),
        },
        'Mail delivery failed; job scheduled for retry',
      );
    }
    return true;
  }

  private claimFilter(job: MailOutboxFields & { _id: Types.ObjectId }) {
    return {
      _id: job._id,
      lockedAt: job.lockedAt,
      attempts: job.attempts,
      deliveredAt: null,
    };
  }
}
