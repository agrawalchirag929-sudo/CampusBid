import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuctionEngine, type AuctionEngine } from '../src/engine.js';
import type {
  AuctionFields,
  PlaceBidCode,
  PlaceBidFailure,
  PlaceBidInput,
  PlaceBidResult,
  PlaceBidSuccess,
} from '../src/types.js';
import { connectTestDatabase, startMongoReplicaSet } from './helpers/mongo.js';
import type { Connection } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';

const baseTime = new Date('2026-10-27T10:00:00.000Z');
let now = new Date(baseTime);
let replicaSet: MongoMemoryReplSet;
let rootConnection: Connection;
let engineConnection: Connection;
let engine: AuctionEngine;
let dbNumber = 0;

const collegeId = new Types.ObjectId();
const sellerId = new Types.ObjectId();

async function seedAuction(
  overrides: Partial<AuctionFields> = {},
): Promise<Types.ObjectId> {
  const auctionId = new Types.ObjectId();
  await engine.models.Auction.create({
    _id: auctionId,
    collegeId,
    sellerId,
    listingId: new Types.ObjectId(),
    status: 'active',
    startPricePaise: 10_000,
    currentPricePaise: 10_000,
    minIncrementPaise: 1,
    startsAt: new Date(baseTime.getTime() - 60_000),
    endsAt: new Date(baseTime.getTime() + 3_600_000),
    version: 0,
    currentBidId: null,
    winnerBidId: null,
    extensionCount: 0,
    ...overrides,
  });
  return auctionId;
}

function makeBid(
  auctionId: Types.ObjectId,
  overrides: Partial<PlaceBidInput> = {},
): PlaceBidInput {
  return {
    auctionId: auctionId.toString(),
    bidderId: new Types.ObjectId().toString(),
    collegeId: collegeId.toString(),
    amountPaise: 10_000,
    idemKey: new Types.ObjectId().toString(),
    ...overrides,
  };
}

function isBidSuccess(
  result: Awaited<ReturnType<AuctionEngine['placeBid']>>,
): result is PlaceBidSuccess {
  return result.ok;
}

async function assert500BidInvariants(
  auctionId: Types.ObjectId,
  requestedAmounts: number[],
  settled: PromiseSettledResult<PlaceBidResult>[],
  models: AuctionEngine['models'],
): Promise<void> {
  const thrownErrors = settled.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  expect(settled).toHaveLength(500);
  expect(thrownErrors).toHaveLength(0);

  const results = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  expect(results).toHaveLength(500);
  const accepted = results.filter(isBidSuccess);
  const rejected = results.filter(
    (result): result is PlaceBidFailure => !result.ok,
  );
  const rejectionCodes = new Set<PlaceBidCode>([
    'OUTBID',
    'TOO_LOW',
    'ENDED',
    'NOT_ACTIVE',
    'SELF_BID',
    'WRONG_COLLEGE',
    'IDEMPOTENCY_CONFLICT',
  ]);
  expect(accepted.length + rejected.length).toBe(500);
  expect(rejected.every((result) => rejectionCodes.has(result.code))).toBe(
    true,
  );

  const byCommitVersion = [...accepted].sort(
    (left, right) => left.auction.version - right.auction.version,
  );
  for (let index = 1; index < byCommitVersion.length; index += 1) {
    expect(byCommitVersion[index]!.auction.version).toBeGreaterThan(
      byCommitVersion[index - 1]!.auction.version,
    );
    expect(byCommitVersion[index]!.bid.amountPaise).toBeGreaterThan(
      byCommitVersion[index - 1]!.bid.amountPaise,
    );
  }

  const persistedBids = await models.Bid.find({ auctionId }).lean().exec();
  const persistedByVersion = persistedBids.sort(
    (left, right) =>
      left.auctionSnapshot.version - right.auctionSnapshot.version,
  );
  expect(persistedByVersion).toHaveLength(accepted.length);
  for (let index = 1; index < persistedByVersion.length; index += 1) {
    expect(persistedByVersion[index]!.auctionSnapshot.version).toBeGreaterThan(
      persistedByVersion[index - 1]!.auctionSnapshot.version,
    );
    expect(persistedByVersion[index]!.amountPaise).toBeGreaterThan(
      persistedByVersion[index - 1]!.amountPaise,
    );
  }
  for (const bid of persistedByVersion) {
    expect(
      await models.Bid.countDocuments({
        auctionId,
        amountPaise: bid.amountPaise,
      }),
    ).toBe(1);
  }

  const initialAuction = await models.Auction.findById(auctionId).lean().exec();
  if (!initialAuction) throw new Error('Auction fixture disappeared');
  const finalAuction = await models.Auction.findById(auctionId).lean().exec();
  if (!finalAuction) throw new Error('Auction fixture disappeared');
  const highestAccepted = Math.max(
    ...accepted.map((result) => result.bid.amountPaise),
  );
  const highestSubmitted = Math.max(...requestedAmounts);
  const expectedHighestAccepted =
    initialAuction.startPricePaise +
    Math.floor(
      (highestSubmitted - initialAuction.startPricePaise) /
        initialAuction.minIncrementPaise,
    ) *
      initialAuction.minIncrementPaise;
  const winningBid = accepted.find(
    (result) => result.bid.amountPaise === highestAccepted,
  );
  expect(finalAuction.currentPricePaise).toBe(expectedHighestAccepted);
  expect(finalAuction.currentPricePaise).toBe(highestAccepted);
  expect(finalAuction.currentBidId?.toString()).toBe(winningBid?.bid._id);
  expect(finalAuction.version).toBe(
    accepted.length + finalAuction.extensionCount,
  );
}

describe('transactional auction engine', () => {
  beforeAll(async () => {
    replicaSet = await startMongoReplicaSet();
    rootConnection = await connectTestDatabase(
      replicaSet.getUri('campusbid_engine_test'),
      100,
    );
  }, 120_000);

  beforeEach(async () => {
    now = new Date(baseTime);
    await rootConnection.dropDatabase();
    const connection = rootConnection.useDb(`engine_case_${dbNumber++}`);
    engine = createAuctionEngine({ connection, clock: () => new Date(now) });
    engineConnection = engine.models.Auction.db;
    await engine.ensureIndexes();
  });

  afterAll(async () => {
    await rootConnection.dropDatabase();
    await rootConnection.close();
    await replicaSet.stop();
  });

  it('returns normal rejections for too-low, self, and cross-college bids', async () => {
    const auctionId = await seedAuction();
    const tooLow = await engine.placeBid(
      makeBid(auctionId, { amountPaise: 9_999 }),
    );
    expect(tooLow).toMatchObject({
      ok: false,
      code: 'TOO_LOW',
      currentPricePaise: 10_000,
    });

    const selfBid = await engine.placeBid(
      makeBid(auctionId, {
        bidderId: sellerId.toString(),
        amountPaise: 9_999,
      }),
    );
    expect(selfBid).toMatchObject({ ok: false, code: 'SELF_BID' });

    const crossCollege = await engine.placeBid(
      makeBid(auctionId, {
        collegeId: new Types.ObjectId().toString(),
        amountPaise: 10_000,
      }),
    );
    expect(crossCollege).toMatchObject({ ok: false, code: 'WRONG_COLLEGE' });
    expect(await engine.models.Bid.countDocuments({ auctionId })).toBe(0);
  });

  it('returns OUTBID, ENDED, and NOT_ACTIVE as normal rejection values', async () => {
    const outbidAuctionId = await seedAuction();
    const first = await engine.placeBid(
      makeBid(outbidAuctionId, { amountPaise: 10_000 }),
    );
    expect(first.ok).toBe(true);
    const outbid = await engine.placeBid(
      makeBid(outbidAuctionId, { amountPaise: 10_000, idemKey: 'outbid-key' }),
    );
    expect(outbid).toMatchObject({ ok: false, code: 'OUTBID' });

    const endedAuctionId = await seedAuction({
      endsAt: new Date(now.getTime() - 1_000),
    });
    const ended = await engine.placeBid(
      makeBid(endedAuctionId, { amountPaise: 9_999 }),
    );
    expect(ended).toMatchObject({ ok: false, code: 'ENDED' });

    const inactiveAuctionId = await seedAuction({ status: 'scheduled' });
    const inactive = await engine.placeBid(makeBid(inactiveAuctionId));
    expect(inactive).toMatchObject({ ok: false, code: 'NOT_ACTIVE' });
  });

  it('serializes 500 parallel distinct and duplicate price bids without lost updates', async () => {
    const auctionId = await seedAuction();
    const requestedAmounts = Array.from(
      { length: 500 },
      (_, index) => 10_001 + Math.floor(index / 2),
    );
    const settled = await Promise.allSettled(
      requestedAmounts.map((amountPaise, index) =>
        engine.placeBid(
          makeBid(auctionId, {
            amountPaise,
            idemKey: 'parallel-' + index,
          }),
        ),
      ),
    );

    await assert500BidInvariants(
      auctionId,
      requestedAmounts,
      settled,
      engine.models,
    );
  }, 180_000);

  it('handles 500 bids across three independent engine instances', async () => {
    const auctionId = await seedAuction();
    const engines = Array.from({ length: 3 }, () =>
      createAuctionEngine({
        connection: engineConnection,
        clock: () => new Date(now),
        retry: { maxAttempts: 32 },
      }),
    );
    expect(new Set(engines).size).toBe(3);
    await Promise.all(engines.map((instance) => instance.ensureIndexes()));

    const requestedAmounts = Array.from(
      { length: 500 },
      (_, index) => 10_001 + Math.floor(index / 2),
    );
    const settled = await Promise.allSettled(
      requestedAmounts.map((amountPaise, index) =>
        engines[index % engines.length]!.placeBid(
          makeBid(auctionId, {
            amountPaise,
            idemKey: 'multi-engine-' + index,
          }),
        ),
      ),
    );

    await assert500BidInvariants(
      auctionId,
      requestedAmounts,
      settled,
      engines[0]!.models,
    );
  }, 180_000);

  it('returns one original bid for 50 parallel idempotent requests', async () => {
    const auctionId = await seedAuction();
    const input = makeBid(auctionId, {
      amountPaise: 10_000,
      idemKey: 'same-request-50-times',
    });
    const results = await Promise.all(
      Array.from({ length: 50 }, () => engine.placeBid(input)),
    );
    const successes = results.filter(isBidSuccess);
    expect(successes).toHaveLength(50);
    expect(new Set(successes.map((result) => result.bid._id)).size).toBe(1);
    expect(await engine.models.Bid.countDocuments({ auctionId })).toBe(1);
    expect(
      await engine.models.Auction.findById(auctionId).then(
        (item) => item?.version,
      ),
    ).toBe(1);
  }, 60_000);

  it('scopes idempotency by bidder and returns the original snapshot for retries', async () => {
    const auctionId = await seedAuction();
    const input = makeBid(auctionId, {
      amountPaise: 10_000,
      idemKey: 'bidder-scoped-key',
    });
    const first = await engine.placeBid(input);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('Expected first bid to be accepted');

    const otherBidder = await engine.placeBid(
      makeBid(auctionId, {
        bidderId: new Types.ObjectId().toString(),
        amountPaise: 10_001,
        idemKey: input.idemKey,
      }),
    );
    expect(otherBidder.ok).toBe(true);

    const replay = await engine.placeBid(input);
    expect(replay).toMatchObject({
      ok: true,
      bid: { _id: first.bid._id },
      auction: {
        version: first.auction.version,
        currentPricePaise: first.auction.currentPricePaise,
      },
    });

    const conflict = await engine.placeBid({ ...input, amountPaise: 10_002 });
    expect(conflict).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(await engine.models.Bid.countDocuments({ auctionId })).toBe(2);
  });
  it('extends late bids, leaves early bids unchanged, and stops at the extension cap', async () => {
    const lateAuctionId = await seedAuction({
      endsAt: new Date(now.getTime() + 30_000),
    });
    const lateBid = await engine.placeBid(makeBid(lateAuctionId));
    expect(lateBid).toMatchObject({
      ok: true,
      auction: { extensionCount: 1, version: 2 },
    });
    if (!lateBid.ok) throw new Error('Expected late bid to be accepted');
    expect(lateBid.auction.endsAt.getTime()).toBe(baseTime.getTime() + 90_000);

    const earlyAuctionId = await seedAuction({
      endsAt: new Date(now.getTime() + 120_000),
    });
    const earlyBid = await engine.placeBid(makeBid(earlyAuctionId));
    expect(earlyBid).toMatchObject({
      ok: true,
      auction: { extensionCount: 0, version: 1 },
    });
    if (!earlyBid.ok) throw new Error('Expected early bid to be accepted');
    expect(earlyBid.auction.endsAt.getTime()).toBe(
      baseTime.getTime() + 120_000,
    );

    const cappedAuctionId = await seedAuction({
      endsAt: new Date(now.getTime() + 30_000),
    });
    for (let index = 0; index < 10; index += 1) {
      const auction = await engine.models.Auction.findById(cappedAuctionId)
        .lean()
        .exec();
      if (!auction) throw new Error('Auction fixture disappeared');
      now = new Date(auction.endsAt.getTime() - 30_000);
      const result = await engine.placeBid(
        makeBid(cappedAuctionId, { amountPaise: 10_000 + index + 1 }),
      );
      expect(result.ok).toBe(true);
    }

    const cappedAuction = await engine.models.Auction.findById(cappedAuctionId)
      .lean()
      .exec();
    if (!cappedAuction) throw new Error('Auction fixture disappeared');
    expect(cappedAuction.extensionCount).toBe(10);
    expect(cappedAuction.version).toBe(20);
    now = new Date(cappedAuction.endsAt.getTime() - 30_000);
    const endBeforeCapRetry = cappedAuction.endsAt.getTime();
    const capRetry = await engine.placeBid(
      makeBid(cappedAuctionId, { amountPaise: 10_011 }),
    );
    expect(capRetry).toMatchObject({
      ok: true,
      auction: { extensionCount: 10, version: 21 },
    });
    if (!capRetry.ok) throw new Error('Expected post-cap bid to be accepted');
    expect(capRetry.auction.endsAt.getTime()).toBe(endBeforeCapRetry);
  }, 30_000);

  it('activates due scheduled auctions and closes due auctions exactly once across three workers', async () => {
    const scheduledId = await seedAuction({
      status: 'scheduled',
      startsAt: new Date(now.getTime() - 1_000),
      endsAt: new Date(now.getTime() + 14_400_000),
    });
    const activated = await engine.activateDueAuctions(now, 10);
    expect(activated.map((auction) => auction._id)).toContain(
      scheduledId.toString(),
    );
    expect(
      activated.find((auction) => auction._id === scheduledId.toString()),
    ).toMatchObject({
      status: 'active',
      version: 1,
    });

    const winnerId = await seedAuction({ reservePricePaise: 10_000 });
    const winningBid = await engine.placeBid(makeBid(winnerId));
    expect(winningBid.ok).toBe(true);

    const reserveMissId = await seedAuction({ reservePricePaise: 20_000 });
    const reserveMissBid = await engine.placeBid(makeBid(reserveMissId));
    expect(reserveMissBid.ok).toBe(true);

    const noBidId = await seedAuction();
    const closeAt = new Date(baseTime.getTime() + 3_700_000);
    const workerResults = await Promise.all(
      Array.from({ length: 3 }, () => engine.closeDueAuctions(closeAt, 20)),
    );
    const closed = workerResults.flat();
    expect(closed).toHaveLength(3);
    expect(new Set(closed.map((auction) => auction._id)).size).toBe(3);
    expect(
      closed.find((auction) => auction._id === winnerId.toString()),
    ).toMatchObject({
      status: 'ended',
      winnerBidId: winningBid.ok ? winningBid.bid._id : null,
    });
    expect(
      closed.find((auction) => auction._id === reserveMissId.toString()),
    ).toMatchObject({
      status: 'unsold',
      winnerBidId: null,
    });
    expect(
      closed.find((auction) => auction._id === noBidId.toString()),
    ).toMatchObject({
      status: 'unsold',
      winnerBidId: null,
    });
    expect(await engine.closeDueAuctions(closeAt, 20)).toEqual([]);
  }, 60_000);
});
