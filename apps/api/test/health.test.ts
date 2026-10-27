import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auctionEngine, app } from '../src/app.js';
import { createTemporaryHeaderAuth } from '../src/middleware/auth-stub.js';
import { startMongoReplicaSet } from './helpers/mongo-replset.js';

const now = new Date();

describe('API health, bidding adapter, and replica-set test helper', () => {
  let replicaSetUri: string;
  let stopReplicaSet: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const replicaSet = await startMongoReplicaSet();
    replicaSetUri = replicaSet.getUri();
    stopReplicaSet = async () => {
      await replicaSet.stop();
    };
    await mongoose.connect(replicaSetUri, { maxPoolSize: 100 });
    await auctionEngine.ensureIndexes();
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await stopReplicaSet?.();
  });

  it('reports healthy without exposing internal details', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('runs a MongoDB transaction on the replica set', async () => {
    const collection = mongoose.connection.collection(
      'phase0_transaction_probe',
    );
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await collection.insertOne({ probe: 'transaction works' }, { session });
      });
      await expect(
        collection.countDocuments({ probe: 'transaction works' }),
      ).resolves.toBe(1);
    } finally {
      await session.endSession();
    }
  }, 30_000);

  it('validates the bid adapter and submits a bid with the temporary auth headers', async () => {
    const collegeId = new Types.ObjectId();
    const sellerId = new Types.ObjectId();
    const bidderId = new Types.ObjectId();
    const auction = await auctionEngine.models.Auction.create({
      collegeId,
      sellerId,
      listingId: new Types.ObjectId(),
      status: 'active',
      startPricePaise: 1_000,
      currentPricePaise: 1_000,
      minIncrementPaise: 100,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 3_600_000),
      version: 0,
      currentBidId: null,
      winnerBidId: null,
      extensionCount: 0,
    });

    const success = await request(app)
      .post(`/auctions/${auction._id.toString()}/bids`)
      .set('x-user-id', bidderId.toString())
      .set('x-college-id', collegeId.toString())
      .set('Idempotency-Key', 'api-adapter-key')
      .send({ amountPaise: 1_000 })
      .expect(200);
    expect(success.body).toMatchObject({
      ok: true,
      bid: { amountPaise: 1_000 },
    });

    await request(app)
      .post(`/auctions/${auction._id.toString()}/bids`)
      .set('x-user-id', bidderId.toString())
      .set('x-college-id', collegeId.toString())
      .send({ amountPaise: 1_100 })
      .expect(400);

    await request(app)
      .post(`/auctions/${auction._id.toString()}/bids`)
      .send({ amountPaise: 1_100 })
      .expect(401);
  });

  it.each([
    { label: 'unset', value: undefined },
    { label: 'production', value: 'production' },
    { label: 'staging', value: 'staging' },
  ])('refuses temporary auth when NODE_ENV is $label', ({ value }) => {
    const previousNodeEnv = process.env.NODE_ENV;
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;

    try {
      expect(() => createTemporaryHeaderAuth()).toThrow(
        'TEMPORARY header authentication is allowed only in development or test',
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it.each(['development', 'test'] as const)(
    'allows temporary auth when NODE_ENV is %s',
    (value) => {
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = value;

      try {
        expect(() => createTemporaryHeaderAuth()).not.toThrow();
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      }
    },
  );
});
