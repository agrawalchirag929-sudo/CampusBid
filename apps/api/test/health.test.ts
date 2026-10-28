import mongoose, { Types } from 'mongoose';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auctionEngine, app, ensureApiIndexes } from '../src/app.js';
import { createCollegeModel } from '../src/modules/colleges/model.js';
import { createUserModel } from '../src/modules/users/model.js';
import { startMongoReplicaSet } from './helpers/mongo-replset.js';

const now = new Date();
const jwtKey = new TextEncoder().encode(process.env.JWT_SECRET);

describe('API health, replica-set setup, and authenticated bid adapter', () => {
  let stopReplicaSet: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const replicaSet = await startMongoReplicaSet();
    stopReplicaSet = async () => {
      await replicaSet.stop();
    };
    await mongoose.connect(replicaSet.getUri(), { maxPoolSize: 100 });
    await ensureApiIndexes();
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

  it('requires a verified database user for bids and ignores spoofed identity headers', async () => {
    const collegeId = new Types.ObjectId();
    const sellerId = new Types.ObjectId();
    const bidderId = new Types.ObjectId();
    await createCollegeModel(mongoose.connection).create({
      _id: collegeId,
      name: 'Test College',
      slug: `test-${collegeId.toString()}`,
      emailDomains: [`${collegeId.toString()}.example`],
      active: true,
    });
    await createUserModel(mongoose.connection).create({
      _id: bidderId,
      email: `${bidderId.toString()}@${collegeId.toString()}.example`,
      passwordHash: 'unused-in-auth-middleware-test',
      collegeId,
      roles: ['BUYER', 'SELLER'],
      status: 'active',
      emailVerifiedAt: now,
      name: 'Verified Buyer',
    });
    const accessToken = await new SignJWT({
      collegeId: collegeId.toString(),
      roles: ['BUYER'],
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('campusbid-api')
      .setAudience('campusbid-client')
      .setSubject(bidderId.toString())
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(jwtKey);
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

    await request(app)
      .post(`/auctions/${auction._id.toString()}/bids`)
      .set('Idempotency-Key', 'missing-auth')
      .send({ amountPaise: 1_000 })
      .expect(401);

    await request(app)
      .post(`/auctions/${auction._id.toString()}/bids`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', 'spoofed-body')
      .send({
        amountPaise: 1_000,
        bidderId: sellerId.toString(),
        collegeId: sellerId.toString(),
      })
      .expect(400);

    const accepted = await request(app)
      .post(`/auctions/${auction._id.toString()}/bids`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set(['x-user', '-id'].join(''), sellerId.toString())
      .set(['x-college', '-id'].join(''), sellerId.toString())
      .set('Idempotency-Key', 'auth-derived-bidder')
      .send({ amountPaise: 1_000 })
      .expect(200);
    expect(accepted.body).toMatchObject({
      ok: true,
      bid: { bidderId: bidderId.toString(), collegeId: collegeId.toString() },
    });
  });
});
