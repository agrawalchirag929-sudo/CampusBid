import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT } from 'jose';
import mongoose, { Types } from 'mongoose';
import { io as socketClient, type Socket } from 'socket.io-client';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  type AuctionReplayAck,
  type AuctionRoomAck,
  type BidPlacedEvent,
  type RealtimeClientToServerEvents,
  type RealtimeServerToClientEvents,
} from '@campusbid/shared';
import {
  createAuctionEngine,
  createAuctionModels,
} from '@campusbid/auction-engine';
import { loadConfig } from '../../../src/config.js';
import { createApp } from '../../../src/app.js';
import { createCollegeModel } from '../../../src/modules/colleges/model.js';
import { createListingModel } from '../../../src/modules/listings/model.js';
import { createUserModel } from '../../../src/modules/users/model.js';
import {
  createRealtimeServer,
  type RealtimeServerHandle,
} from '../../../src/modules/realtime/server.js';
import { startMongoReplicaSet } from '../../helpers/mongo-replset.js';

type TestSocket = Socket<
  RealtimeServerToClientEvents,
  RealtimeClientToServerEvents
>;

const config = loadConfig();
const jwtKey = new TextEncoder().encode(config.JWT_SECRET);
const engine = createAuctionEngine({ connection: mongoose.connection });
const { Auction, Bid } = createAuctionModels(mongoose.connection);
const User = createUserModel(mongoose.connection);
const College = createCollegeModel(mongoose.connection);
const Listing = createListingModel(mongoose.connection);

let stopReplicaSet: (() => Promise<void>) | undefined;
let collegeA: Types.ObjectId;
let collegeB: Types.ObjectId;
let sellerId: Types.ObjectId;
let buyerAId: Types.ObjectId;
let buyerBId: Types.ObjectId;
let realtime: RealtimeServerHandle | undefined;
let clients: TestSocket[] = [];
let baseUrl: string;
let listingId: Types.ObjectId;

async function accessToken(
  userId: Types.ObjectId,
  collegeId: Types.ObjectId,
  expiresIn: string | number = '15m',
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ collegeId: collegeId.toString(), roles: ['BUYER'] })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('campusbid-api')
    .setAudience('campusbid-client')
    .setSubject(userId.toString())
    .setIssuedAt(now)
    .setExpirationTime(
      typeof expiresIn === 'number' ? now + expiresIn : expiresIn,
    )
    .sign(jwtKey);
}

async function makeUser(
  email: string,
  collegeId: Types.ObjectId,
): Promise<Types.ObjectId> {
  const user = await User.create({
    email,
    passwordHash: 'test-hash-not-used-by-sockets',
    collegeId,
    roles: ['BUYER', 'SELLER'],
    status: 'active',
    emailVerifiedAt: new Date(),
    name: email.split('@')[0] ?? 'Campus User',
  });
  return user._id;
}

async function makeAuction(
  options: {
    status?: 'active' | 'scheduled';
    endsAt?: Date;
    reservePricePaise?: number;
  } = {},
): Promise<Types.ObjectId> {
  const auction = await Auction.create({
    collegeId: collegeA,
    sellerId,
    listingId,
    status: options.status ?? 'active',
    startPricePaise: 1_000,
    currentPricePaise: 1_000,
    minIncrementPaise: 1,
    ...(options.reservePricePaise === undefined
      ? {}
      : { reservePricePaise: options.reservePricePaise }),
    startsAt: new Date(Date.now() - 60_000),
    endsAt: options.endsAt ?? new Date(Date.now() + 3_600_000),
    version: 0,
    currentBidId: null,
    winnerBidId: null,
    extensionCount: 0,
  });
  return auction._id;
}

async function startRealtime(): Promise<void> {
  const httpServer = createServer(
    createApp({ config, connection: mongoose.connection, engine }),
  );
  realtime = createRealtimeServer({
    httpServer,
    connection: mongoose.connection,
    engine,
    config,
  });
  realtime.start();
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address() as AddressInfo | null;
  if (!address) throw new Error('Realtime test server has no address');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
}

async function connectClient(
  userId: Types.ObjectId = buyerAId,
  collegeId: Types.ObjectId = collegeA,
  expiresIn: string | number = '15m',
): Promise<TestSocket> {
  const socket = socketClient(baseUrl, {
    auth: { accessToken: await accessToken(userId, collegeId, expiresIn) },
    transports: ['websocket'],
    reconnection: false,
    timeout: 5_000,
  }) as TestSocket;
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

function joinAuction(
  socket: TestSocket,
  auctionId: Types.ObjectId,
): Promise<AuctionRoomAck> {
  return new Promise((resolve) => {
    socket.emit('auction.join', { auctionId: auctionId.toString() }, resolve);
  });
}

function waitForEvent<T>(
  socket: TestSocket,
  event: keyof RealtimeServerToClientEvents,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${String(event)}`));
    }, timeoutMs);
    const handler = (value: unknown): void => {
      clearTimeout(timer);
      resolve(value as T);
    };
    socket.once(event, handler);
  });
}

function collectBids(
  socket: TestSocket,
  expectedCount: number,
): Promise<BidPlacedEvent[]> {
  return new Promise((resolve, reject) => {
    const events: BidPlacedEvent[] = [];
    const timer = setTimeout(() => {
      socket.off('bid.placed', handler);
      reject(
        new Error(
          `Received ${String(events.length)} of ${String(expectedCount)} bids`,
        ),
      );
    }, 20_000);
    const handler = (event: BidPlacedEvent): void => {
      events.push(event);
      if (events.length === expectedCount) {
        clearTimeout(timer);
        socket.off('bid.placed', handler);
        resolve(events);
      }
    };
    socket.on('bid.placed', handler);
  });
}

async function placeBid(
  auctionId: Types.ObjectId,
  bidderId = buyerAId,
  amountPaise = 1_001,
  idemKey = new Types.ObjectId().toString(),
) {
  return engine.placeBid({
    auctionId: auctionId.toString(),
    bidderId: bidderId.toString(),
    collegeId: collegeA.toString(),
    amountPaise,
    idemKey,
  });
}

beforeAll(async () => {
  const replicaSet = await startMongoReplicaSet();
  stopReplicaSet = async () => {
    await replicaSet.stop();
  };
  await mongoose.connect(replicaSet.getUri(), { maxPoolSize: 100 });
  await Promise.all([
    College.init(),
    User.init(),
    Listing.init(),
    Auction.init(),
    Bid.init(),
  ]);
  await engine.ensureIndexes();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all([
    College.init(),
    User.init(),
    Listing.init(),
    Auction.init(),
    Bid.init(),
  ]);
  const [collegeOne, collegeTwo] = await College.create([
    {
      name: 'Campus A',
      slug: 'campus-a',
      emailDomains: ['a.edu'],
      active: true,
    },
    {
      name: 'Campus B',
      slug: 'campus-b',
      emailDomains: ['b.edu'],
      active: true,
    },
  ]);
  if (!collegeOne || !collegeTwo)
    throw new Error('College fixture was not created');
  collegeA = collegeOne._id;
  collegeB = collegeTwo._id;
  sellerId = await makeUser('seller@a.edu', collegeA);
  buyerAId = await makeUser('buyer@a.edu', collegeA);
  buyerBId = await makeUser('buyer@b.edu', collegeB);
  const listing = await Listing.create({
    collegeId: collegeA,
    sellerId,
    title: 'Engineering Textbook',
    description: 'A used engineering textbook',
    category: 'textbooks',
    condition: 'good',
    photos: [],
  });
  listingId = listing._id;
  await startRealtime();
});

afterEach(async () => {
  for (const client of clients) client.disconnect();
  clients = [];
  await realtime?.close();
  realtime = undefined;
});

afterAll(async () => {
  await mongoose.disconnect();
  await stopReplicaSet?.();
});

describe('realtime Socket.IO layer', () => {
  it('broadcasts the committed bid to both clients with no identity fields', async () => {
    const auctionId = await makeAuction();
    const first = await connectClient();
    const second = await connectClient();
    const initialState = waitForEvent<{
      auctionId: string;
      snapshot: { id: string };
    }>(first, 'auction.state');
    expect((await joinAuction(first, auctionId)).ok).toBe(true);
    expect((await joinAuction(second, auctionId)).ok).toBe(true);
    expect(await initialState).toMatchObject({
      auctionId: auctionId.toString(),
      snapshot: { id: auctionId.toString() },
    });
    const firstBid = waitForEvent<BidPlacedEvent>(first, 'bid.placed');
    const secondBid = waitForEvent<BidPlacedEvent>(second, 'bid.placed');

    const result = await placeBid(auctionId);
    expect(result.ok).toBe(true);
    const events = await Promise.all([firstBid, secondBid]);
    expect(events[0]).toEqual(events[1]);
    expect(events[0]?.amountPaise).toBe(1_001);
    expect(events[0]?.bidderLabel).toBe('Bidder 1');
    expect(JSON.stringify(events[0])).not.toContain(buyerAId.toString());
    expect(JSON.stringify(events[0])).not.toContain('buyer@a.edu');
  });

  it('denies cross-college room joins and does not deliver their bids', async () => {
    const auctionId = await makeAuction();
    const sameCollege = await connectClient();
    const otherCollege = await connectClient(buyerBId, collegeB);
    const denied = await joinAuction(otherCollege, auctionId);
    expect(denied).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect((await joinAuction(sameCollege, auctionId)).ok).toBe(true);

    let leaked = false;
    otherCollege.on('bid.placed', () => {
      leaked = true;
    });
    await placeBid(auctionId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(leaked).toBe(false);
  });

  it('replays missed bids by version and resyncs joined rooms after a stream restart', async () => {
    const auctionId = await makeAuction();
    const client = await connectClient();
    expect((await joinAuction(client, auctionId)).ok).toBe(true);
    await placeBid(auctionId, buyerAId, 1_001, 'replay-1');
    await placeBid(auctionId, buyerAId, 1_002, 'replay-2');

    const replay = await new Promise<AuctionReplayAck>((resolve) => {
      client.emit(
        'auction.replay',
        { auctionId: auctionId.toString(), lastSeenVersion: 0 },
        resolve,
      );
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.mode).toBe('events');
      if (replay.mode === 'events') {
        expect(replay.events.map((event) => event.amountPaise)).toEqual([
          1_001, 1_002,
        ]);
      }
    }

    const resync = waitForEvent<{ auctionId: string; version: number }>(
      client,
      'auction.resync',
    );
    await realtime?.restartChangeStream();
    expect(await resync).toMatchObject({
      auctionId: auctionId.toString(),
      version: 2,
    });
  });

  it('broadcasts activation, sold closure, unsold closure and cancellation', async () => {
    const scheduledAuctionId = await makeAuction({ status: 'scheduled' });
    const buyer = await connectClient();
    expect((await joinAuction(buyer, scheduledAuctionId)).ok).toBe(true);
    const activated = waitForEvent<{ version: number }>(
      buyer,
      'auction.activated',
    );
    await engine.activateDueAuctions(new Date());
    expect((await activated).version).toBe(1);

    const soldAuctionId = await makeAuction({
      endsAt: new Date(Date.now() + 3_600_000),
    });
    const unsoldAuctionId = await makeAuction({
      endsAt: new Date(Date.now() - 1_000),
    });
    const client = await connectClient();
    expect((await joinAuction(client, soldAuctionId)).ok).toBe(true);
    expect((await joinAuction(client, unsoldAuctionId)).ok).toBe(true);
    await placeBid(soldAuctionId);
    await Auction.updateOne(
      { _id: soldAuctionId },
      { $set: { endsAt: new Date(Date.now() - 1_000) } },
    ).exec();
    const ended = waitForEvent<{ version: number; winnerLabel: string }>(
      client,
      'auction.ended',
    );
    const unsold = waitForEvent<{ version: number }>(client, 'auction.unsold');
    const closed = await engine.closeDueAuctions(new Date());
    expect(closed).toHaveLength(2);
    expect((await ended).winnerLabel).toBe('Bidder 1');
    expect((await unsold).version).toBe(2);

    const cancelAuctionId = await makeAuction({ status: 'scheduled' });
    expect((await joinAuction(client, cancelAuctionId)).ok).toBe(true);
    const cancelled = waitForEvent<{ version: number }>(
      client,
      'auction.cancelled',
    );
    const cancelResult = await engine.cancelAuction({
      auctionId: cancelAuctionId.toString(),
      collegeId: collegeA.toString(),
    });
    expect(cancelResult.ok).toBe(true);
    expect((await cancelled).version).toBe(1);
  });

  it('validates socket payloads and enforces the 20-room limit', async () => {
    const client = await connectClient();
    const invalid = await new Promise<AuctionRoomAck>((resolve) => {
      client.emit('auction.join', { auctionId: 'bad-id' }, resolve);
    });
    expect(invalid).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
    const auctionIds = await Promise.all(
      Array.from({ length: 21 }, () => makeAuction()),
    );
    const results = [];
    for (const auctionId of auctionIds) {
      results.push(await joinAuction(client, auctionId));
    }
    expect(results.slice(0, 20).every((result) => result.ok)).toBe(true);
    expect(results[20]).toEqual({ ok: false, error: 'ROOM_LIMIT' });
  });

  it('disconnects a socket when its verified access token expires', async () => {
    const client = await connectClient(buyerAId, collegeA, 2);
    const disconnected = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Socket did not disconnect at token expiry')),
        5_000,
      );
      client.once('disconnect', (reason) => {
        clearTimeout(timer);
        resolve(reason);
      });
    });
    expect(await disconnected).toBe('io server disconnect');
  });

  it('keeps both clients in the same increasing version order across 100 parallel bids', async () => {
    const auctionId = await makeAuction();
    const first = await connectClient();
    const second = await connectClient();
    expect((await joinAuction(first, auctionId)).ok).toBe(true);
    expect((await joinAuction(second, auctionId)).ok).toBe(true);
    const firstEvents = collectBids(first, 100);
    const secondEvents = collectBids(second, 100);

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        placeBid(
          auctionId,
          buyerAId,
          1_001 + index,
          `parallel-${String(index)}`,
        ),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const [firstFeed, secondFeed] = await Promise.all([
      firstEvents,
      secondEvents,
    ]);
    expect(firstFeed.map((event) => event.version)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    expect(secondFeed.map((event) => event.version)).toEqual(
      firstFeed.map((event) => event.version),
    );
    expect(firstFeed.at(-1)?.amountPaise).toBe(1_100);
    expect(secondFeed.at(-1)?.amountPaise).toBe(1_100);
    expect({
      version: firstFeed.at(-1)?.version,
      amountPaise: firstFeed.at(-1)?.amountPaise,
      endsAt: firstFeed.at(-1)?.endsAt,
      bidIds: new Set(firstFeed.map((event) => event.bidId)).size,
    }).toEqual({
      version: secondFeed.at(-1)?.version,
      amountPaise: secondFeed.at(-1)?.amountPaise,
      endsAt: secondFeed.at(-1)?.endsAt,
      bidIds: new Set(secondFeed.map((event) => event.bidId)).size,
    });
    expect(new Set(firstFeed.map((event) => event.bidId)).size).toBe(100);
  });
});
