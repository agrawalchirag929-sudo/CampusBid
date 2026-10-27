import {
  Types,
  type ClientSession,
  type Connection,
  type QueryFilter,
  type UpdateWithAggregationPipeline,
} from 'mongoose';
import {
  DEFAULT_ANTI_SNIPING,
  resolveAntiSnipingConfig,
  type AntiSnipingConfig,
} from './anti-sniping.js';
import {
  AuctionCloseInvariantError,
  AuctionEngineInputError,
  TransactionRetryLimitError,
} from './errors.js';
import { createAuctionModels } from './models.js';
import { KeyedAsyncQueue } from './auction-queue.js';
import { isValidPaise, minimumNextBidPaise } from './pricing.js';
import { assertAuctionTransition } from './state-machine.js';
import type {
  AuctionFields,
  AuctionRecord,
  AuctionSnapshot,
  BidReceipt,
  BidRecord,
  PlaceBidFailure,
  PlaceBidInput,
  PlaceBidResult,
  PlaceBidSuccess,
  StoredAuctionSnapshot,
} from './types.js';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 32;
const BASE_BACKOFF_MS = 4;
const MAX_BACKOFF_MS = 32;

export interface EngineRetryOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface AuctionEngineLogger {
  debug(fields: Record<string, unknown>, message: string): void;
}

export interface AuctionEngineOptions {
  connection: Connection;
  logger?: AuctionEngineLogger;
  clock?: () => Date;
  antiSniping?: Partial<AntiSnipingConfig>;
  retry?: EngineRetryOptions;
}

export interface AuctionEngine {
  readonly models: ReturnType<typeof createAuctionModels>;
  ensureIndexes(): Promise<void>;
  placeBid(input: PlaceBidInput): Promise<PlaceBidResult>;
  activateDueAuctions(
    now?: Date,
    batchSize?: number,
  ): Promise<AuctionSnapshot[]>;
  closeDueAuctions(now?: Date, batchSize?: number): Promise<AuctionSnapshot[]>;
}

function toStoredAuctionSnapshot(
  auction: AuctionRecord,
): StoredAuctionSnapshot {
  return {
    _id: auction._id,
    collegeId: auction.collegeId,
    sellerId: auction.sellerId,
    listingId: auction.listingId,
    status: auction.status,
    startPricePaise: auction.startPricePaise,
    currentPricePaise: auction.currentPricePaise,
    minIncrementPaise: auction.minIncrementPaise,
    ...(auction.reservePricePaise === undefined
      ? {}
      : { reservePricePaise: auction.reservePricePaise }),
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
    version: auction.version,
    currentBidId: auction.currentBidId,
    winnerBidId: auction.winnerBidId,
    extensionCount: auction.extensionCount,
  };
}

function toAuctionSnapshot(
  auction: AuctionRecord | StoredAuctionSnapshot,
): AuctionSnapshot {
  return {
    _id: auction._id.toString(),
    collegeId: auction.collegeId.toString(),
    sellerId: auction.sellerId.toString(),
    listingId: auction.listingId.toString(),
    status: auction.status,
    startPricePaise: auction.startPricePaise,
    currentPricePaise: auction.currentPricePaise,
    minIncrementPaise: auction.minIncrementPaise,
    ...(auction.reservePricePaise === undefined
      ? {}
      : { reservePricePaise: auction.reservePricePaise }),
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
    version: auction.version,
    currentBidId: auction.currentBidId?.toString() ?? null,
    winnerBidId: auction.winnerBidId?.toString() ?? null,
    extensionCount: auction.extensionCount,
  };
}

function toBidReceipt(bid: BidRecord): BidReceipt {
  return {
    _id: bid._id.toString(),
    auctionId: bid.auctionId.toString(),
    collegeId: bid.collegeId.toString(),
    bidderId: bid.bidderId.toString(),
    amountPaise: bid.amountPaise,
    idemKey: bid.idemKey,
    createdAt: bid.createdAt,
  };
}

function resultFromExistingBid(
  bid: BidRecord,
  requestedAmountPaise: number,
): PlaceBidResult {
  const auction = toAuctionSnapshot(bid.auctionSnapshot);
  if (bid.amountPaise !== requestedAmountPaise) {
    return {
      ok: false,
      code: 'IDEMPOTENCY_CONFLICT',
      currentPricePaise: auction.currentPricePaise,
      version: auction.version,
    };
  }
  return { ok: true, auction, bid: toBidReceipt(bid) };
}

function toPlaceBidSuccess(
  auction: AuctionRecord,
  bid: BidRecord,
): PlaceBidSuccess {
  return {
    ok: true,
    auction: toAuctionSnapshot(auction),
    bid: toBidReceipt(bid),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorCode(error: unknown): number | undefined {
  if (!isObject(error)) return undefined;
  return typeof error.code === 'number' ? error.code : undefined;
}

function errorCodeName(error: unknown): string | undefined {
  if (!isObject(error)) return undefined;
  return typeof error.codeName === 'string' ? error.codeName : undefined;
}

function hasErrorLabel(error: unknown, label: string): boolean {
  if (!isObject(error)) return false;
  const checker = error.hasErrorLabel;
  if (typeof checker === 'function') {
    return checker.call(error, label) === true;
  }
  return Array.isArray(error.errorLabels) && error.errorLabels.includes(label);
}

function isTransientTransactionError(error: unknown): boolean {
  return (
    hasErrorLabel(error, 'TransientTransactionError') ||
    hasErrorLabel(error, 'UnknownTransactionCommitResult') ||
    errorCode(error) === 112 ||
    errorCodeName(error) === 'WriteConflict'
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return errorCode(error) === 11000 || errorCodeName(error) === 'DuplicateKey';
}

function isTransactionAlreadyEnded(error: unknown): boolean {
  return (
    errorCode(error) === 251 || errorCodeName(error) === 'NoSuchTransaction'
  );
}

async function abortPreservingError(
  session: ClientSession,
  originalError: unknown,
): Promise<void> {
  if (!session.inTransaction()) return;
  try {
    await session.abortTransaction();
  } catch (abortError) {
    if (!isTransactionAlreadyEnded(abortError)) {
      throw new AggregateError(
        [originalError, abortError],
        'The transaction failed and its abort also failed',
      );
    }
  }
}

function validateBidInput(input: PlaceBidInput): void {
  const objectIdFields = [input.auctionId, input.bidderId, input.collegeId];
  if (!objectIdFields.every((value) => /^[\da-f]{24}$/i.test(value))) {
    throw new AuctionEngineInputError(
      'auctionId, bidderId, and collegeId must be ObjectIds',
    );
  }
  if (!isValidPaise(input.amountPaise)) {
    throw new AuctionEngineInputError(
      'amountPaise must be a non-negative integer',
    );
  }
  if (input.idemKey.length === 0 || input.idemKey.length > 200) {
    throw new AuctionEngineInputError(
      'idemKey must contain 1 to 200 characters',
    );
  }
}

function validClockDate(clock: () => Date): Date {
  const now = clock();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new AuctionEngineInputError(
      'The engine clock returned an invalid date',
    );
  }
  return now;
}

function mongoErrorCode(error: unknown): number | string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === 'number' || typeof code === 'string'
    ? code
    : undefined;
}

function resultCodeForAuction(
  auction: AuctionRecord | null,
  input: PlaceBidInput,
  now: Date,
): PlaceBidFailure | null {
  if (!auction) {
    return { ok: false, code: 'NOT_ACTIVE', currentPricePaise: 0, version: 0 };
  }

  let code: PlaceBidFailure['code'] | undefined;
  if (!auction.collegeId.equals(input.collegeId)) {
    code = 'WRONG_COLLEGE';
  } else if (auction.sellerId.equals(input.bidderId)) {
    code = 'SELF_BID';
  } else if (auction.status !== 'active') {
    code = 'NOT_ACTIVE';
  } else if (auction.endsAt.getTime() <= now.getTime()) {
    code = 'ENDED';
  } else if (input.amountPaise < minimumNextBidPaise(auction)) {
    code = auction.currentBidId === null ? 'TOO_LOW' : 'OUTBID';
  }

  if (!code) return null;
  return {
    ok: false,
    code,
    currentPricePaise: auction.currentPricePaise,
    version: auction.version,
  };
}
function validateBatchSize(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
    throw new AuctionEngineInputError(
      'batchSize must be an integer from 1 to 10000',
    );
  }
}

function validateDate(now: Date): void {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new AuctionEngineInputError('now must be a valid date');
  }
}

function randomBackoff(
  attempt: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
): Promise<void> {
  const ceiling = Math.min(maxBackoffMs, baseBackoffMs * 2 ** (attempt - 1));
  const delayMs = Math.floor(Math.random() * (ceiling + 1));
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function createAuctionEngine(
  options: AuctionEngineOptions,
): AuctionEngine {
  const { Auction, Bid } = createAuctionModels(options.connection);
  const auctionQueue = new KeyedAsyncQueue();
  const clock = options.clock ?? (() => new Date());
  const antiSniping = resolveAntiSnipingConfig(options.antiSniping);
  const maxAttempts = options.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseBackoffMs = options.retry?.baseBackoffMs ?? BASE_BACKOFF_MS;
  const maxBackoffMs = options.retry?.maxBackoffMs ?? MAX_BACKOFF_MS;

  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 32
  ) {
    throw new AuctionEngineInputError(
      'maxAttempts must be an integer from 1 to 32',
    );
  }
  if (!Number.isSafeInteger(baseBackoffMs) || baseBackoffMs < 0) {
    throw new AuctionEngineInputError(
      'baseBackoffMs must be a non-negative integer',
    );
  }
  if (!Number.isSafeInteger(maxBackoffMs) || maxBackoffMs < baseBackoffMs) {
    throw new AuctionEngineInputError(
      'maxBackoffMs must be at least baseBackoffMs',
    );
  }

  async function findExistingBid(
    input: PlaceBidInput,
    session?: ClientSession,
  ): Promise<BidRecord | null> {
    let query = Bid.findOne({
      auctionId: new Types.ObjectId(input.auctionId),
      bidderId: new Types.ObjectId(input.bidderId),
      idemKey: input.idemKey,
    });
    if (session) query = query.session(session);
    return query.lean().exec();
  }

  async function classifyFailure(
    input: PlaceBidInput,
    now: Date,
  ): Promise<PlaceBidFailure | null> {
    const auction = await Auction.findById(input.auctionId).lean().exec();
    return resultCodeForAuction(auction, input, now);
  }

  function logTransientRetry(
    operation: 'placeBid' | 'closeAuction',
    auctionId: string,
    attempt: number,
    retryCount: number,
    error: unknown,
  ): void {
    options.logger?.debug(
      {
        event: 'auction_engine.transient_retry',
        operation,
        auctionId,
        attempt,
        retryCount,
        maxAttempts,
        mongoCode: mongoErrorCode(error),
      },
      'Retrying after a transient MongoDB error',
    );
  }

  async function placeBid(input: PlaceBidInput): Promise<PlaceBidResult> {
    validateBidInput(input);
    return auctionQueue.run(input.auctionId, () => placeBidWithRetry(input));
  }

  async function placeBidWithRetry(
    input: PlaceBidInput,
  ): Promise<PlaceBidResult> {
    const auctionId = new Types.ObjectId(input.auctionId);
    const bidderId = new Types.ObjectId(input.bidderId);
    const collegeId = new Types.ObjectId(input.collegeId);

    const existingBid = await findExistingBid(input);
    if (existingBid)
      return resultFromExistingBid(existingBid, input.amountPaise);

    const precheckAuction = await Auction.findById(auctionId)
      .read('primary')
      .lean()
      .exec();
    const precheckNow = validClockDate(clock);
    if (
      precheckAuction &&
      precheckAuction.status === 'active' &&
      precheckAuction.endsAt.getTime() > precheckNow.getTime() &&
      precheckAuction.collegeId.equals(collegeId) &&
      !precheckAuction.sellerId.equals(bidderId) &&
      input.amountPaise < minimumNextBidPaise(precheckAuction)
    ) {
      const idempotentBid = await findExistingBid(input);
      if (idempotentBid) {
        return resultFromExistingBid(idempotentBid, input.amountPaise);
      }
      const failure = resultCodeForAuction(precheckAuction, input, precheckNow);
      if (failure) return failure;
    }

    let retryCount = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const session = await options.connection.startSession();
      try {
        session.startTransaction({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        });

        const existingBid = await findExistingBid(input, session);
        if (existingBid) {
          await session.abortTransaction();
          return resultFromExistingBid(existingBid, input.amountPaise);
        }

        const attemptNow = validClockDate(clock);
        const bidId = new Types.ObjectId();
        const minimumExpression = {
          $cond: [
            { $eq: [{ $ifNull: ['$currentBidId', null] }, null] },
            '$startPricePaise',
            { $add: ['$currentPricePaise', '$minIncrementPaise'] },
          ],
        };
        const atomicFilter = {
          _id: auctionId,
          collegeId,
          status: 'active',
          endsAt: { $gt: attemptNow },
          sellerId: { $ne: bidderId },
          $expr: { $gte: [input.amountPaise, minimumExpression] },
        } as QueryFilter<AuctionFields>;
        const shouldExtend = {
          $and: [
            { $lt: ['$extensionCount', antiSniping.maxExtensions] },
            {
              $lte: [
                '$endsAt',
                new Date(attemptNow.getTime() + antiSniping.windowMs),
              ],
            },
          ],
        };
        const updatePipeline: UpdateWithAggregationPipeline = [
          {
            $set: {
              currentPricePaise: input.amountPaise,
              currentBidId: bidId,
              endsAt: {
                $cond: [
                  shouldExtend,
                  { $add: ['$endsAt', antiSniping.extensionMs] },
                  '$endsAt',
                ],
              },
              extensionCount: {
                $cond: [
                  shouldExtend,
                  { $add: ['$extensionCount', 1] },
                  '$extensionCount',
                ],
              },
              version: { $add: ['$version', { $cond: [shouldExtend, 2, 1] }] },
            },
          },
        ];
        const updatedAuction = await Auction.findOneAndUpdate(
          atomicFilter,
          updatePipeline,
          { session, updatePipeline: true, returnDocument: 'after' },
        )
          .lean()
          .exec();

        if (!updatedAuction) {
          await session.abortTransaction();
          const failure = await classifyFailure(input, attemptNow);
          if (failure) return failure;
          if (attempt < maxAttempts) {
            await randomBackoff(attempt, baseBackoffMs, maxBackoffMs);
            continue;
          }
          throw new TransactionRetryLimitError(maxAttempts);
        }
        const auctionSnapshot = toStoredAuctionSnapshot(updatedAuction);
        const bidDocument = new Bid({
          _id: bidId,
          auctionId,
          collegeId,
          bidderId,
          amountPaise: input.amountPaise,
          idemKey: input.idemKey,
          createdAt: attemptNow,
          auctionSnapshot,
        });
        await bidDocument.save({ session });
        await session.commitTransaction();
        const savedBid = bidDocument.toObject() as BidRecord;
        return toPlaceBidSuccess(updatedAuction, savedBid);
      } catch (error) {
        await abortPreservingError(session, error);
        if (isDuplicateKeyError(error)) {
          const originalBid = await findExistingBid(input);
          if (originalBid)
            return resultFromExistingBid(originalBid, input.amountPaise);
          const failure = await classifyFailure(input, validClockDate(clock));
          if (failure) return failure;
          if (attempt < maxAttempts) {
            await randomBackoff(attempt, baseBackoffMs, maxBackoffMs);
            continue;
          }
          throw new TransactionRetryLimitError(maxAttempts, { cause: error });
        }
        if (isTransientTransactionError(error)) {
          if (attempt < maxAttempts) {
            retryCount += 1;
            logTransientRetry(
              'placeBid',
              input.auctionId,
              attempt,
              retryCount,
              error,
            );
            await randomBackoff(attempt, baseBackoffMs, maxBackoffMs);
            continue;
          }
          const failure = await classifyFailure(input, validClockDate(clock));
          if (failure) return failure;
          throw new TransactionRetryLimitError(maxAttempts, { cause: error });
        }
        throw error;
      } finally {
        await session.endSession();
      }
    }

    throw new TransactionRetryLimitError(maxAttempts);
  }

  async function activateDueAuctions(
    now: Date = validClockDate(clock),
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<AuctionSnapshot[]> {
    validateDate(now);
    validateBatchSize(batchSize);
    const dueAuctions = await Auction.find({
      status: 'scheduled',
      startsAt: { $lte: now },
    })
      .hint('auction_status_startsAt')
      .select({ _id: 1 })
      .sort({ startsAt: 1, _id: 1 })
      .limit(batchSize)
      .lean()
      .exec();
    const activated: AuctionSnapshot[] = [];

    for (const candidate of dueAuctions) {
      assertAuctionTransition('scheduled', 'active');
      const auction = await Auction.findOneAndUpdate(
        { _id: candidate._id, status: 'scheduled', startsAt: { $lte: now } },
        { $set: { status: 'active' }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      )
        .lean()
        .exec();
      if (auction) activated.push(toAuctionSnapshot(auction));
    }

    return activated;
  }

  async function closeOneAuction(
    auctionId: Types.ObjectId,
    now: Date,
  ): Promise<AuctionSnapshot | null> {
    assertAuctionTransition('active', 'ended');
    let retryCount = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const session = await options.connection.startSession();
      try {
        session.startTransaction({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
        });
        const hasWinner = {
          $and: [
            { $ne: ['$currentBidId', null] },
            {
              $or: [
                { $eq: [{ $ifNull: ['$reservePricePaise', null] }, null] },
                { $gte: ['$currentPricePaise', '$reservePricePaise'] },
              ],
            },
          ],
        };
        const closePipeline: UpdateWithAggregationPipeline = [
          {
            $set: {
              status: 'ended',
              winnerBidId: { $cond: [hasWinner, '$currentBidId', null] },
              version: { $add: ['$version', 1] },
            },
          },
        ];
        const endedAuction = await Auction.findOneAndUpdate(
          { _id: auctionId, status: 'active', endsAt: { $lte: now } },
          closePipeline,
          { session, updatePipeline: true, returnDocument: 'after' },
        )
          .lean()
          .exec();
        if (!endedAuction) {
          await session.abortTransaction();
          return null;
        }

        let finalAuction = endedAuction;
        if (!endedAuction.winnerBidId) {
          assertAuctionTransition('ended', 'unsold');
          const unsoldAuction = await Auction.findOneAndUpdate(
            {
              _id: endedAuction._id,
              status: 'ended',
              version: endedAuction.version,
            },
            {
              $set: { status: 'unsold', winnerBidId: null },
              $inc: { version: 1 },
            },
            { session, returnDocument: 'after' },
          )
            .lean()
            .exec();
          if (!unsoldAuction)
            throw new AuctionCloseInvariantError(auctionId.toString());
          finalAuction = unsoldAuction;
        }

        await session.commitTransaction();
        return toAuctionSnapshot(finalAuction);
      } catch (error) {
        await abortPreservingError(session, error);
        if (isTransientTransactionError(error) && attempt < maxAttempts) {
          retryCount += 1;
          logTransientRetry(
            'closeAuction',
            auctionId.toString(),
            attempt,
            retryCount,
            error,
          );
          await randomBackoff(attempt, baseBackoffMs, maxBackoffMs);
          continue;
        }
        if (isTransientTransactionError(error)) {
          throw new TransactionRetryLimitError(maxAttempts, { cause: error });
        }
        throw error;
      } finally {
        await session.endSession();
      }
    }
    throw new TransactionRetryLimitError(maxAttempts);
  }

  async function closeDueAuctions(
    now: Date = validClockDate(clock),
    batchSize = DEFAULT_BATCH_SIZE,
  ): Promise<AuctionSnapshot[]> {
    validateDate(now);
    validateBatchSize(batchSize);
    const dueAuctions = await Auction.find({
      status: 'active',
      endsAt: { $lte: now },
    })
      .select({ _id: 1 })
      .sort({ endsAt: 1, _id: 1 })
      .limit(batchSize)
      .lean()
      .exec();
    const closed: AuctionSnapshot[] = [];

    for (const candidate of dueAuctions) {
      const result = await closeOneAuction(candidate._id, now);
      if (result) closed.push(result);
    }

    return closed;
  }

  return {
    models: { Auction, Bid },
    ensureIndexes: async () => {
      await Promise.all([Auction.init(), Bid.init()]);
    },
    placeBid,
    activateDueAuctions,
    closeDueAuctions,
  };
}

export { DEFAULT_ANTI_SNIPING };
