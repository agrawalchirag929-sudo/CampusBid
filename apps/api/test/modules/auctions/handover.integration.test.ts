import { SignJWT } from 'jose';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MyBid } from '@campusbid/shared';
import {
  createAuctionEngine,
  createAuctionModels,
} from '@campusbid/auction-engine';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config.js';
import { createHandoverSecretModel } from '../../../src/modules/auctions/handover-secret.js';
import {
  decryptHandoverCode,
  hashHandoverCode,
} from '../../../src/modules/auctions/handover-code.js';
import { createListingModel } from '../../../src/modules/listings/model.js';
import { AuctionNotificationService } from '../../../src/modules/notifications/auction-events.js';
import { createMailOutboxModel } from '../../../src/modules/notifications/model.js';
import { createCollegeModel } from '../../../src/modules/colleges/model.js';
import { createUserModel } from '../../../src/modules/users/model.js';
import { startMongoReplicaSet } from '../../helpers/mongo-replset.js';

const config = loadConfig();
const jwtKey = new TextEncoder().encode(config.JWT_SECRET);
const engine = createAuctionEngine({ connection: mongoose.connection });
const { Auction, Bid } = createAuctionModels(mongoose.connection);
const College = createCollegeModel(mongoose.connection);
const User = createUserModel(mongoose.connection);
const Listing = createListingModel(mongoose.connection);
const HandoverSecret = createHandoverSecretModel(mongoose.connection);
const MailOutbox = createMailOutboxModel(mongoose.connection);
const api = createApp({ config, connection: mongoose.connection, engine });
let stopReplicaSet: (() => Promise<void>) | undefined;
let fixtureSequence = 0;

interface HandoverFixture {
  auctionId: Types.ObjectId;
  sellerId: Types.ObjectId;
  sellerCollegeId: Types.ObjectId;
  otherSellerId: Types.ObjectId;
  otherCollegeId: Types.ObjectId;
  winnerId: Types.ObjectId;
  previousBidderId: Types.ObjectId;
  code: string;
}

async function token(
  userId: Types.ObjectId,
  collegeId: Types.ObjectId,
  roles: string[],
): Promise<string> {
  return new SignJWT({ collegeId: collegeId.toString(), roles })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('campusbid-api')
    .setAudience('campusbid-client')
    .setSubject(userId.toString())
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(jwtKey);
}

async function createUser(
  collegeId: Types.ObjectId,
  role: 'SELLER' | 'BUYER',
  name: string,
): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await User.create({
    _id: id,
    email: `${id.toString()}@campus.example`,
    passwordHash: 'not-used-by-access-token-test',
    collegeId,
    roles: [role],
    status: 'active',
    emailVerifiedAt: new Date(),
    name,
  });
  return id;
}

async function createHandoverFixture(): Promise<HandoverFixture> {
  fixtureSequence += 1;
  const sellerCollegeId = new Types.ObjectId();
  const otherCollegeId = new Types.ObjectId();
  await College.create([
    {
      _id: sellerCollegeId,
      name: 'Campus Handover A',
      slug: `handover-a-${fixtureSequence}`,
      emailDomains: [`handover-a-${fixtureSequence}.example`],
      active: true,
    },
    {
      _id: otherCollegeId,
      name: 'Campus Handover B',
      slug: `handover-b-${fixtureSequence}`,
      emailDomains: [`handover-b-${fixtureSequence}.example`],
      active: true,
    },
  ]);
  const sellerId = await createUser(
    sellerCollegeId,
    'SELLER',
    'Auction Seller',
  );
  const otherSellerId = await createUser(
    sellerCollegeId,
    'SELLER',
    'Different Seller',
  );
  const winnerId = await createUser(sellerCollegeId, 'BUYER', 'Auction Winner');
  const previousBidderId = await createUser(
    sellerCollegeId,
    'BUYER',
    'Previous Bidder',
  );
  const listingId = new Types.ObjectId();
  const auctionId = new Types.ObjectId();
  const previousBidId = new Types.ObjectId();
  const winnerBidId = new Types.ObjectId();
  const endsAt = new Date(Date.now() - 1_000);
  await Listing.create({
    _id: listingId,
    collegeId: sellerCollegeId,
    sellerId,
    title: 'Used Engineering Textbook',
    description: 'A clean textbook ready for handover.',
    category: 'textbooks',
    condition: 'good',
    photos: [],
  });
  const snapshot = {
    _id: auctionId,
    collegeId: sellerCollegeId,
    sellerId,
    listingId,
    status: 'ended' as const,
    startPricePaise: 10_000,
    currentPricePaise: 15_000,
    minIncrementPaise: 500,
    startsAt: new Date(Date.now() - 60_000),
    endsAt,
    version: 2,
    currentBidId: winnerBidId,
    winnerBidId,
    extensionCount: 0,
  };
  await Auction.create(snapshot);
  await Bid.create([
    {
      _id: previousBidId,
      auctionId,
      collegeId: sellerCollegeId,
      bidderId: previousBidderId,
      amountPaise: 10_000,
      idemKey: 'previous-bid',
      createdAt: new Date(Date.now() - 2_000),
      auctionSnapshot: {
        ...snapshot,
        version: 1,
        currentPricePaise: 10_000,
        currentBidId: previousBidId,
        winnerBidId: null,
      },
    },
    {
      _id: winnerBidId,
      auctionId,
      collegeId: sellerCollegeId,
      bidderId: winnerId,
      amountPaise: 15_000,
      idemKey: 'winner-bid',
      createdAt: new Date(Date.now() - 1_000),
      auctionSnapshot: {
        ...snapshot,
        currentBidId: winnerBidId,
        winnerBidId: null,
      },
    },
  ]);
  const notifications = new AuctionNotificationService(
    mongoose.connection,
    config.MAIL_OUTBOX_KEY,
    config.JWT_SECRET,
  );
  await notifications.handleAuctionStatus(auctionId, 'ended');
  const secret = await HandoverSecret.findOne({ auctionId })
    .select('+encryptedCode')
    .lean()
    .exec();
  if (!secret?.encryptedCode)
    throw new Error('Expected generated handover code');
  return {
    auctionId,
    sellerId,
    sellerCollegeId,
    otherSellerId,
    otherCollegeId,
    winnerId,
    previousBidderId,
    code: decryptHandoverCode(secret.encryptedCode, config.MAIL_OUTBOX_KEY),
  };
}

function handoverRequest(
  fixture: HandoverFixture,
  userId: Types.ObjectId,
  collegeId: Types.ObjectId,
  code: string,
  expectedStatus?: number,
): Promise<request.Response> {
  return token(userId, collegeId, ['SELLER']).then((accessToken) => {
    const test = request(api)
      .post(`/auctions/${fixture.auctionId.toString()}/handover`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code });
    return expectedStatus === undefined ? test : test.expect(expectedStatus);
  });
}

describe('seller handover confirmation', () => {
  beforeAll(async () => {
    const replicaSet = await startMongoReplicaSet();
    stopReplicaSet = async () => {
      await replicaSet.stop();
    };
    await mongoose.connect(replicaSet.getUri(), { maxPoolSize: 100 });
    await Promise.all([
      engine.ensureIndexes(),
      College.init(),
      User.init(),
      Listing.init(),
      HandoverSecret.init(),
      MailOutbox.init(),
    ]);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await Promise.all([
      engine.ensureIndexes(),
      College.init(),
      User.init(),
      Listing.init(),
      HandoverSecret.init(),
      MailOutbox.init(),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await stopReplicaSet?.();
  });

  it('shows the code only in the winning buyer’s bid list', async () => {
    const fixture = await createHandoverFixture();
    const auction = await Auction.findById(fixture.auctionId)
      .select('+handoverCodeHash')
      .lean()
      .exec();
    expect(auction?.handoverCodeHash).toBe(
      hashHandoverCode(
        fixture.auctionId.toString(),
        fixture.code,
        config.JWT_SECRET,
      ),
    );
    expect(auction?.handoverCodeHash).not.toBe(fixture.code);
    const winnerToken = await token(fixture.winnerId, fixture.sellerCollegeId, [
      'BUYER',
    ]);
    const winnerResponse = await request(api)
      .get('/me/bids')
      .set('Authorization', `Bearer ${winnerToken}`)
      .expect(200);
    expect(winnerResponse.headers['cache-control']).toBe('private, no-store');
    const winnerBids = winnerResponse.body as MyBid[];
    expect(winnerBids).toHaveLength(1);
    expect(winnerBids[0]?.handoverCode).toBe(fixture.code);

    const previousBidderToken = await token(
      fixture.previousBidderId,
      fixture.sellerCollegeId,
      ['BUYER'],
    );
    const previousBids = (
      await request(api)
        .get('/me/bids')
        .set('Authorization', `Bearer ${previousBidderToken}`)
        .expect(200)
    ).body as MyBid[];
    expect(previousBids).toHaveLength(1);
    expect(previousBids[0]?.handoverCode).toBeUndefined();
  });

  it('returns 404 for another seller or another college and counts a wrong code', async () => {
    const fixture = await createHandoverFixture();
    await handoverRequest(
      fixture,
      fixture.otherSellerId,
      fixture.sellerCollegeId,
      fixture.code,
      404,
    );
    const crossCollegeSellerId = await createUser(
      fixture.otherCollegeId,
      'SELLER',
      'Cross College Seller',
    );
    await handoverRequest(
      fixture,
      crossCollegeSellerId,
      fixture.otherCollegeId,
      fixture.code,
      404,
    );
    const wrongCode = fixture.code === '000000' ? '000001' : '000000';
    await handoverRequest(
      fixture,
      fixture.sellerId,
      fixture.sellerCollegeId,
      wrongCode,
      400,
    );
    const auction = await Auction.findById(fixture.auctionId).lean().exec();
    expect(auction?.handoverAttempts).toBe(1);
    expect(auction?.status).toBe('ended');
  });

  it('allows at most five wrong attempts when submitted concurrently', async () => {
    const fixture = await createHandoverFixture();
    const wrongCode = fixture.code === '000000' ? '000001' : '000000';
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        handoverRequest(
          fixture,
          fixture.sellerId,
          fixture.sellerCollegeId,
          wrongCode,
        ),
      ),
    );
    const statuses = attempts.map((response) => response.status);
    expect(statuses.filter((status) => status === 400)).toHaveLength(5);
    expect(statuses.filter((status) => status === 409)).toHaveLength(5);
    const auction = await Auction.findById(fixture.auctionId).lean().exec();
    expect(auction?.handoverAttempts).toBe(5);
    expect(auction?.status).toBe('ended');
  });

  it('marks an auction paid once under concurrent valid confirmations', async () => {
    const fixture = await createHandoverFixture();
    const responses = await Promise.all([
      handoverRequest(
        fixture,
        fixture.sellerId,
        fixture.sellerCollegeId,
        fixture.code,
      ),
      handoverRequest(
        fixture,
        fixture.sellerId,
        fixture.sellerCollegeId,
        fixture.code,
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      responses.find((response) => response.status === 200)?.body,
    ).toMatchObject({
      id: fixture.auctionId.toString(),
      status: 'paid',
    });
    await handoverRequest(
      fixture,
      fixture.sellerId,
      fixture.sellerCollegeId,
      fixture.code,
      409,
    );
    const auction = await Auction.findById(fixture.auctionId)
      .select('+handoverCodeHash')
      .lean()
      .exec();
    expect(auction?.status).toBe('paid');
    expect(auction?.handoverCodeHash).toBeNull();
    expect(auction?.handoverConfirmedAt).toBeInstanceOf(Date);
    const secret = await HandoverSecret.findOne({
      auctionId: fixture.auctionId,
    })
      .select('+encryptedCode')
      .lean()
      .exec();
    expect(secret?.encryptedCode).toBeNull();
    expect(secret?.consumedAt).toBeInstanceOf(Date);
  });
});
