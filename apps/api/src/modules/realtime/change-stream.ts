import type { AuctionFields, BidFields } from '@campusbid/auction-engine';
import type { Connection, PipelineStage, Types } from 'mongoose';

export interface RealtimeBidDocument extends BidFields {
  _id: Types.ObjectId;
}

export interface RealtimeChange {
  operationType: string;
  ns?: { coll?: string };
  fullDocument?: RealtimeBidDocument | null;
  documentKey?: { _id?: Types.ObjectId };
  updateDescription?: { updatedFields?: Record<string, unknown> };
}

const relevantChangePipeline: PipelineStage[] = [
  {
    $match: {
      $or: [
        { operationType: 'insert', 'ns.coll': 'bids' },
        {
          operationType: 'update',
          'ns.coll': 'auctions',
          'updateDescription.updatedFields.status': {
            $in: ['active', 'ended', 'paid', 'unsold', 'cancelled'],
          },
        },
        {
          operationType: 'update',
          'ns.coll': 'auctions',
          $or: [
            {
              'updateDescription.updatedFields.handoverCodeHash': {
                $exists: true,
              },
            },
            {
              'updateDescription.updatedFields.handoverAttempts': {
                $exists: true,
              },
            },
          ],
        },
      ],
    },
  },
];

export interface ChangeStreamLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

export class AuctionChangeStream {
  private stream: ReturnType<Connection['watch']> | undefined;
  private restartTimer: NodeJS.Timeout | undefined;
  private closed = false;
  private restartAttempt = 0;
  private eventChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly connection: Connection,
    private readonly onChange: (change: RealtimeChange) => Promise<void>,
    private readonly onRestart: () => void | Promise<void>,
    private readonly logger: ChangeStreamLogger,
  ) {}

  start(): void {
    this.open(true);
  }

  async restart(): Promise<void> {
    if (this.closed) throw new Error('Change stream is closed');
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    const current = this.stream;
    this.stream = undefined;
    if (current) await current.close();
    this.open(true);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    const current = this.stream;
    this.stream = undefined;
    if (current) await current.close();
    await this.eventChain;
  }

  private open(emitResync: boolean): void {
    if (this.closed) return;
    try {
      const stream = this.connection.watch<RealtimeBidDocument>(
        relevantChangePipeline,
        { maxAwaitTimeMS: 1_000 },
      );
      this.stream = stream;
      if (emitResync) void this.onRestart();
      stream.on('change', (change) => {
        this.restartAttempt = 0;
        this.eventChain = this.eventChain
          .then(() => this.onChange(change as unknown as RealtimeChange))
          .catch((error: unknown) => {
            this.logger.error({ err: error }, 'Auction change event failed');
          });
      });
      stream.on('error', (error: unknown) => this.scheduleRestart(error));
      stream.on('close', () => {
        if (!this.closed && this.stream === stream) {
          this.scheduleRestart(new Error('Auction change stream closed'));
        }
      });
    } catch (error) {
      this.scheduleRestart(error);
    }
  }

  private scheduleRestart(error: unknown): void {
    if (this.closed || this.restartTimer) return;
    this.logger.error({ err: error }, 'Auction change stream failed');
    const delay = Math.min(30_000, 250 * 2 ** this.restartAttempt);
    this.restartAttempt += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.restartAfterFailure();
    }, delay);
    this.restartTimer.unref();
  }

  private async restartAfterFailure(): Promise<void> {
    const failed = this.stream;
    this.stream = undefined;
    try {
      await failed?.close();
    } catch (closeError) {
      this.logger.error(
        { err: closeError },
        'Failed change stream cleanup failed',
      );
    }
    this.open(true);
  }
}

export function auctionStatusFromChange(change: RealtimeChange): {
  auctionId: Types.ObjectId;
  status: AuctionFields['status'];
  version: number;
} | null {
  if (change.operationType !== 'update' || change.ns?.coll !== 'auctions')
    return null;
  const auctionId = change.documentKey?._id;
  const fields = change.updateDescription?.updatedFields;
  const status = fields?.status;
  const version = fields?.version;
  if (
    !auctionId ||
    typeof status !== 'string' ||
    !['active', 'ended', 'unsold', 'cancelled'].includes(status) ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    return null;
  }
  return {
    auctionId,
    status: status as AuctionFields['status'],
    version,
  };
}

export function auctionHandoverStateFromChange(change: RealtimeChange): {
  auctionId: Types.ObjectId;
  version: number;
} | null {
  if (change.operationType !== 'update' || change.ns?.coll !== 'auctions')
    return null;
  const fields = change.updateDescription?.updatedFields;
  const auctionId = change.documentKey?._id;
  const version = fields?.version;
  const relevantField =
    Object.hasOwn(fields ?? {}, 'handoverCodeHash') ||
    Object.hasOwn(fields ?? {}, 'handoverAttempts') ||
    fields?.status === 'paid';
  if (
    !auctionId ||
    !relevantField ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 0
  ) {
    return null;
  }
  return { auctionId, version };
}
