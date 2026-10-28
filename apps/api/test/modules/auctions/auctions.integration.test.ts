import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { UserRole } from '@campusbid/shared';
import {
  createAuctionEngine,
  type AuctionEngine,
} from '@campusbid/auction-engine';
import { createApp } from '../../../src/app.js';
import { loadConfig } from '../../../src/config.js';
import { createCollegeModel } from '../../../src/modules/colleges/model.js';
import {
  createUserModel,
  type UserFields,
} from '../../../src/modules/users/model.js';
import {
  createListingModel,
  type ListingFields,
} from '../../../src/modules/listings/model.js';
import { startMongoReplicaSet } from '../../helpers/mongo-replset.js';

const key = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'campusbid-test-secret-at-least-32-characters-long',
);
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  JWT_SECRET:
    process.env.JWT_SECRET ??
    'campusbid-test-secret-at-least-32-characters-long',
  MAIL_OUTBOX_KEY:
    process.env.MAIL_OUTBOX_KEY ?? 'campusbid-test-mail-outbox-key-32chars',
  COOKIE_NAME: process.env.COOKIE_NAME ?? 'campusbid_refresh',
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? 'http://localhost:5173',
  CLOUDINARY_CLOUD_NAME: 'campusbid-test',
  CLOUDINARY_API_KEY: 'test-api-key',
  CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
});
const now = new Date();
let engine: AuctionEngine;
let api: ReturnType<typeof createApp>;
let collegeA: Types.ObjectId;
let collegeB: Types.ObjectId;
let sellerA: UserFields & { _id: Types.ObjectId };
let sellerA2: UserFields & { _id: Types.ObjectId };
let sellerB: UserFields & { _id: Types.ObjectId };
let buyerA: UserFields & { _id: Types.ObjectId };
let buyerA2: UserFields & { _id: Types.ObjectId };
let adminA: UserFields & { _id: Types.ObjectId };
let stopReplicaSet: (() => Promise<void>) | undefined;

async function tokenFor(
  user: UserFields & { _id: Types.ObjectId },
): Promise<string> {
  return new SignJWT({
    collegeId: user.collegeId.toString(),
    roles: [...user.roles],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('campusbid-api')
    .setAudience('campusbid-client')
    .setSubject(user._id.toString())
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(key);
}

async function as(user: UserFields & { _id: Types.ObjectId }) {
  return 'Bearer ' + (await tokenFor(user));
}

async function makeUser(
  email: string,
  collegeId: Types.ObjectId,
  roles: UserRole[],
): Promise<UserFields & { _id: Types.ObjectId }> {
  return createUserModel(mongoose.connection).create({
    email,
    passwordHash: 'test-only-unused-hash',
    collegeId,
    roles,
    status: 'active',
    emailVerifiedAt: now,
    name: email.split('@')[0] ?? 'Campus User',
  });
}

function auctionBody(overrides: Record<string, unknown> = {}) {
  const startsAt = new Date(now.getTime() + 60_000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  return {
    title: 'Casio fx-991CW from BMSCE',
    description: 'Excellent condition scientific calculator, campus pickup.',
    category: 'calculators',
    condition: 'good',
    photos: [],
    startPricePaise: 1_000,
    minIncrementPaise: 100,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    ...overrides,
  };
}

async function seedListing(
  collegeId: Types.ObjectId,
  sellerId: Types.ObjectId,
  title: string,
  overrides: Partial<ListingFields> = {},
  id?: Types.ObjectId,
) {
  return createListingModel(mongoose.connection).create({
    ...(id ? { _id: id } : {}),
    collegeId,
    sellerId,
    title,
    description: 'Carefully used engineering item for campus pickup.',
    category: 'textbooks',
    condition: 'good',
    photos: [],
    createdAt: now,
    ...overrides,
  });
}

async function seedAuction(options: {
  collegeId?: Types.ObjectId;
  sellerId?: Types.ObjectId;
  status?: 'active' | 'scheduled' | 'ended';
  price?: number;
  endsAt?: Date;
  listingCreatedAt?: Date;
  title?: string;
  category?: ListingFields['category'];
  id?: Types.ObjectId;
}) {
  const collegeId = options.collegeId ?? collegeA;
  const sellerId = options.sellerId ?? sellerA._id;
  const listing = await seedListing(
    collegeId,
    sellerId,
    options.title ?? 'Seeded campus auction ' + new Types.ObjectId().toString(),
    {
      createdAt: options.listingCreatedAt ?? now,
      ...(options.category ? { category: options.category } : {}),
    },
  );
  return engine.models.Auction.create({
    ...(options.id ? { _id: options.id } : {}),
    collegeId,
    sellerId,
    listingId: listing._id,
    status: options.status ?? 'active',
    startPricePaise: options.price ?? 1_000,
    currentPricePaise: options.price ?? 1_000,
    minIncrementPaise: 100,
    startsAt: new Date(now.getTime() - 60 * 60_000),
    endsAt: options.endsAt ?? new Date(now.getTime() + 2 * 60 * 60_000),
    version: 0,
    currentBidId: null,
    winnerBidId: null,
    extensionCount: 0,
  });
}

beforeAll(async () => {
  const replicaSet = await startMongoReplicaSet();
  stopReplicaSet = async () => {
    await replicaSet.stop();
  };
  await mongoose.connect(replicaSet.getUri(), { maxPoolSize: 100 });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await stopReplicaSet?.();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  const College = createCollegeModel(mongoose.connection);
  const User = createUserModel(mongoose.connection);
  const Listing = createListingModel(mongoose.connection);
  await Promise.all([College.init(), User.init(), Listing.init()]);
  collegeA = new Types.ObjectId();
  collegeB = new Types.ObjectId();
  await College.create([
    {
      _id: collegeA,
      name: 'BMS College of Engineering',
      slug: 'bmsce-test',
      emailDomains: ['bmsce.test'],
      active: true,
    },
    {
      _id: collegeB,
      name: 'Other Engineering College',
      slug: 'other-test',
      emailDomains: ['other.test'],
      active: true,
    },
  ]);
  sellerA = await makeUser('seller@bmsce.test', collegeA, ['SELLER']);
  sellerA2 = await makeUser('seller2@bmsce.test', collegeA, ['SELLER']);
  sellerB = await makeUser('seller@other.test', collegeB, ['SELLER']);
  buyerA = await makeUser('buyer@bmsce.test', collegeA, ['BUYER']);
  buyerA2 = await makeUser('buyer2@bmsce.test', collegeA, ['BUYER']);
  adminA = await makeUser('admin@bmsce.test', collegeA, ['ADMIN']);
  engine = createAuctionEngine({
    connection: mongoose.connection,
    clock: () => new Date(now),
  });
  await engine.ensureIndexes();
  api = createApp({
    config,
    connection: mongoose.connection,
    engine,
    clock: () => new Date(now),
  });
});

describe('college-scoped auctions API', () => {
  it('creates listing and scheduled auction together and validates dates, price and photos', async () => {
    const created = await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerA))
      .send(auctionBody())
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'scheduled',
      startPricePaise: 1_000,
      currentPricePaise: 1_000,
      minIncrementPaise: 100,
      listing: { category: 'calculators', title: 'Casio fx-991CW from BMSCE' },
    });
    expect(
      await createListingModel(mongoose.connection).countDocuments({
        sellerId: sellerA._id,
      }),
    ).toBe(1);

    const tooShort = auctionBody({
      endsAt: new Date(
        new Date(auctionBody().startsAt).getTime() + 9 * 60_000,
      ).toISOString(),
    });
    await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerA))
      .send(tooShort)
      .expect(400);
    await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerA))
      .send(auctionBody({ minIncrementPaise: 0 }))
      .expect(400);
    await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerA))
      .send(
        auctionBody({
          endsAt: new Date(
            new Date(auctionBody().startsAt).getTime() + 15 * 24 * 60 * 60_000,
          ).toISOString(),
        }),
      )
      .expect(400);
    const tooManyPhotos = Array.from({ length: 7 }, (_, index) => ({
      url:
        'https://res.cloudinary.com/campusbid-test/image/upload/v123/campusbid/' +
        collegeA.toString() +
        '/photo-' +
        index +
        '.jpg',
      publicId: 'campusbid/' + collegeA.toString() + '/photo-' + index,
    }));
    await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerA))
      .send(auctionBody({ photos: tooManyPhotos }))
      .expect(400);
    const collegeFolder = 'campusbid/' + collegeA.toString();
    await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerA))
      .send(
        auctionBody({
          photos: [
            {
              url: 'https://example.com/photo.jpg',
              publicId: collegeFolder + '/photo',
            },
          ],
        }),
      )
      .expect(400);
    const publicId = collegeFolder + '/signed-photo';
    await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerA))
      .send(
        auctionBody({
          photos: [
            {
              url:
                'https://res.cloudinary.com/campusbid-test/image/upload/v123/' +
                publicId +
                '.jpg',
              publicId,
            },
          ],
        }),
      )
      .expect(201);
  });

  it('hides another college auction and maps missing and cross-college bids to 404', async () => {
    const auction = await seedAuction({
      collegeId: collegeB,
      sellerId: sellerB._id,
    });
    await request(api)
      .get('/auctions/' + auction._id.toString())
      .set('Authorization', await as(buyerA))
      .expect(404);
    await request(api)
      .get('/auctions/' + new Types.ObjectId().toString())
      .set('Authorization', await as(buyerA))
      .expect(404);
    await request(api)
      .post('/auctions/' + auction._id.toString() + '/bids')
      .set('Authorization', await as(buyerA))
      .set('Idempotency-Key', 'cross-college-bid')
      .send({ amountPaise: 1_000 })
      .expect(404);
    await request(api)
      .post('/auctions/' + new Types.ObjectId().toString() + '/bids')
      .set('Authorization', await as(buyerA))
      .set('Idempotency-Key', 'missing-auction-bid')
      .send({ amountPaise: 1_000 })
      .expect(404);
    await request(api)
      .get('/auctions?status=active')
      .set('Authorization', await as(buyerA))
      .expect(200)
      .then((response) => expect(response.body.items).toHaveLength(0));
  });

  it('enforces owner-only edits and same-college admin cancellation', async () => {
    const created = await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerA))
      .send(auctionBody())
      .expect(201);
    const id = created.body.id as string;
    await request(api)
      .patch('/auctions/' + id)
      .set('Authorization', await as(sellerA2))
      .send({ title: 'Not the owner' })
      .expect(404);
    const patched = await request(api)
      .patch('/auctions/' + id)
      .set('Authorization', await as(sellerA))
      .send({ title: 'Updated calculator title' })
      .expect(200);
    expect(patched.body.listing.title).toBe('Updated calculator title');
    await request(api)
      .post('/auctions/' + id + '/cancel')
      .set('Authorization', await as(adminA))
      .expect(200)
      .then((response) => expect(response.body.status).toBe('cancelled'));

    const ownerCancelled = await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerA))
      .send(auctionBody({ title: 'Seller owned cancel example' }))
      .expect(201);
    await request(api)
      .post('/auctions/' + ownerCancelled.body.id + '/cancel')
      .set('Authorization', await as(sellerA))
      .expect(200);

    const foreign = await request(api)
      .post('/auctions')
      .set('Authorization', await as(sellerB))
      .send(auctionBody())
      .expect(201);
    await request(api)
      .post('/auctions/' + foreign.body.id + '/cancel')
      .set('Authorization', await as(adminA))
      .expect(404);
  });

  it('returns safe detail with stable masked bidders and labels the viewer own bids You', async () => {
    const auction = await seedAuction({
      title: 'Masked bidder calculator listing',
    });
    const first = await engine.placeBid({
      auctionId: auction._id.toString(),
      bidderId: buyerA._id.toString(),
      collegeId: collegeA.toString(),
      amountPaise: 1_000,
      idemKey: 'first-mask-bid',
    });
    const second = await engine.placeBid({
      auctionId: auction._id.toString(),
      bidderId: buyerA2._id.toString(),
      collegeId: collegeA.toString(),
      amountPaise: 1_100,
      idemKey: 'second-mask-bid',
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const firstView = await request(api)
      .get('/auctions/' + auction._id.toString())
      .set('Authorization', await as(buyerA))
      .expect(200);
    expect(firstView.body).toMatchObject({
      sellerName: sellerA.name,
      serverTime: expect.any(String),
      bids: [
        { bidderLabel: 'You', amountPaise: 1_000 },
        { bidderLabel: 'Bidder 2', amountPaise: 1_100 },
      ],
    });
    const serialized = JSON.stringify(firstView.body);
    for (const privateValue of [
      sellerA._id.toString(),
      buyerA._id.toString(),
      buyerA2._id.toString(),
      sellerA.email,
      buyerA2.email,
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    const secondView = await request(api)
      .get('/auctions/' + auction._id.toString())
      .set('Authorization', await as(buyerA2))
      .expect(200);
    expect(secondView.body.bids).toMatchObject([
      { bidderLabel: 'Bidder 1', amountPaise: 1_000 },
      { bidderLabel: 'You', amountPaise: 1_100 },
    ]);
    await request(api)
      .get('/me/bids')
      .set('Authorization', await as(buyerA))
      .expect(200)
      .then((response) => expect(response.body).toHaveLength(1));
    await request(api)
      .get('/me/auctions')
      .set('Authorization', await as(sellerA))
      .expect(200)
      .then((response) => expect(response.body).toHaveLength(1));
  });

  it('filters by category, full-text query, price and defaults to active or scheduled only', async () => {
    await seedAuction({
      title: 'Unique textbook quantum systems',
      price: 1_000,
      status: 'active',
    });
    await seedAuction({
      title: 'Unique calculator scientific exam',
      price: 2_000,
      status: 'scheduled',
      category: 'calculators',
    });
    await seedAuction({
      title: 'Unique ended drafter sale',
      price: 3_000,
      status: 'ended',
    });
    const defaultList = await request(api)
      .get('/auctions')
      .set('Authorization', await as(buyerA))
      .expect(200);
    expect(defaultList.body.items).toHaveLength(2);
    expect(
      defaultList.body.items.every((item: { status: string }) =>
        ['active', 'scheduled'].includes(item.status),
      ),
    ).toBe(true);

    const calculator = await request(api)
      .get('/auctions')
      .query({
        category: 'calculators',
        minPricePaise: 2_000,
        maxPricePaise: 2_000,
      })
      .set('Authorization', await as(buyerA))
      .expect(200);
    expect(calculator.body.items).toHaveLength(1);
    expect(calculator.body.items[0].listing.title).toContain('calculator');
    const text = await request(api)
      .get('/auctions')
      .query({ q: 'scientific exam' })
      .set('Authorization', await as(buyerA))
      .expect(200);
    expect(text.body.items).toHaveLength(1);
    expect(text.body.items[0].listing.category).toBe('calculators');
    const ended = await request(api)
      .get('/auctions')
      .query({ status: 'ended' })
      .set('Authorization', await as(buyerA))
      .expect(200);
    expect(ended.body.items).toHaveLength(1);
  });

  it('keyset paginates every sort with tied values and a stable id tie-breaker', async () => {
    const base = new Date(now.getTime() + 30 * 60_000);
    const fixtures: Array<{
      id: string;
      end: Date;
      created: Date;
      price: number;
    }> = [];
    for (let index = 1; index <= 6; index += 1) {
      const id = new Types.ObjectId(index.toString(16).padStart(24, '0'));
      const tiedTime = new Date(
        base.getTime() + Math.floor((index - 1) / 2) * 60 * 60_000,
      );
      const price = 1_000 + Math.floor((index - 1) / 2) * 500;
      const auction = await seedAuction({
        id,
        title: 'Pagination tie listing ' + index,
        status: index % 2 === 0 ? 'scheduled' : 'active',
        price,
        endsAt: tiedTime,
        listingCreatedAt: tiedTime,
      });
      fixtures.push({
        id: auction._id.toString(),
        end: tiedTime,
        created: tiedTime,
        price,
      });
    }

    for (const sort of [
      'endingSoon',
      'newest',
      'priceLow',
      'priceHigh',
    ] as const) {
      const direction = sort === 'newest' || sort === 'priceHigh' ? -1 : 1;
      const valueFor = (fixture: (typeof fixtures)[number]) =>
        sort === 'endingSoon'
          ? fixture.end.getTime()
          : sort === 'newest'
            ? fixture.created.getTime()
            : fixture.price;
      const expected = [...fixtures]
        .sort((left, right) => {
          const valueOrder = (valueFor(left) - valueFor(right)) * direction;
          if (valueOrder !== 0) return valueOrder;
          return left.id.localeCompare(right.id) * direction;
        })
        .map((fixture) => fixture.id);
      const actual: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const pageRequest = request(api)
          .get('/auctions')
          .query({ sort, limit: 2, ...(cursor ? { cursor } : {}) })
          .set('Authorization', await as(buyerA));
        const response = await pageRequest.expect(200);
        actual.push(
          ...(response.body.items as Array<{ id: string }>).map(
            (item) => item.id,
          ),
        );
        cursor = response.body.pageInfo.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(actual).toEqual(expected);
      expect(new Set(actual).size).toBe(fixtures.length);
    }
  });

  it('signs college-folder uploads with size and format restrictions and enforces rate limits', async () => {
    const signed = await request(api)
      .post('/uploads/sign')
      .set('Authorization', await as(sellerA))
      .expect(200);
    expect(signed.body).toMatchObject({
      cloudName: 'campusbid-test',
      folder: 'campusbid/' + collegeA.toString(),
      allowedFormats: 'jpg,jpeg,png,webp',
      maxFileSize: 10 * 1024 * 1024,
      apiKey: 'test-api-key',
    });
    const signedText =
      [
        'allowed_formats=' + signed.body.allowedFormats,
        'folder=' + signed.body.folder,
        'max_file_size=' + String(signed.body.maxFileSize),
        'timestamp=' + String(signed.body.timestamp),
      ].join('&') + 'test-cloudinary-secret';
    expect(signed.body.signature).toBe(
      createHash('sha1').update(signedText).digest('hex'),
    );
    await request(api)
      .post('/uploads/sign')
      .set('Authorization', await as(buyerA))
      .expect(403);
    const unconfigured = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      JWT_SECRET:
        process.env.JWT_SECRET ??
        'campusbid-test-secret-at-least-32-characters-long',
      MAIL_OUTBOX_KEY:
        process.env.MAIL_OUTBOX_KEY ?? 'campusbid-test-mail-outbox-key-32chars',
      COOKIE_NAME: process.env.COOKIE_NAME ?? 'campusbid_refresh',
      CORS_ORIGINS: process.env.CORS_ORIGINS ?? 'http://localhost:5173',
      CLOUDINARY_CLOUD_NAME: undefined,
      CLOUDINARY_API_KEY: undefined,
      CLOUDINARY_API_SECRET: undefined,
    });
    await request(
      createApp({
        config: unconfigured,
        connection: mongoose.connection,
        engine,
      }),
    )
      .post('/uploads/sign')
      .set('Authorization', await as(sellerA))
      .expect(503);

    const rateLimitedApp = createApp({
      config,
      connection: mongoose.connection,
      engine,
    });
    const auth = await as(sellerA);
    const replies = await Promise.all(
      Array.from({ length: 11 }, () =>
        request(rateLimitedApp)
          .post('/uploads/sign')
          .set('Authorization', auth),
      ),
    );
    expect(replies.filter((reply) => reply.status === 429)).toHaveLength(1);
  });
});
