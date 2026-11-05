import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuctionEngine, BidRecord } from '@campusbid/auction-engine';
import {
  createAuctionEngine,
  createAuctionModels,
} from '@campusbid/auction-engine';
import type { MailProvider } from '../../../src/modules/auth/mail-provider.js';
import { createListingModel } from '../../../src/modules/listings/model.js';
import { decryptHandoverCode } from '../../../src/modules/auctions/handover-code.js';
import { createHandoverSecretModel } from '../../../src/modules/auctions/handover-secret.js';
import { AuctionNotificationService } from '../../../src/modules/notifications/auction-events.js';
import { decryptMailPayload } from '../../../src/modules/notifications/crypto.js';
import { createMailOutboxModel } from '../../../src/modules/notifications/model.js';
import { MailOutboxWorker } from '../../../src/modules/notifications/worker.js';
import type { AuctionNotificationEmailPayload } from '../../../src/modules/notifications/types.js';
import { createUserModel } from '../../../src/modules/users/model.js';
import { startMongoReplicaSet } from '../../helpers/mongo-replset.js';

const outboxKey = process.env.MAIL_OUTBOX_KEY ?? '';

class RecordingProvider implements MailProvider {
  readonly verification: Array<{ to: string; name: string; token: string }> =
    [];
  readonly notifications: AuctionNotificationEmailPayload[] = [];

  async sendVerificationEmail(message: {
    to: string;
    name: string;
    token: string;
  }): Promise<void> {
    this.verification.push(message);
  }

  async sendAuctionNotificationEmail(
    message: AuctionNotificationEmailPayload,
  ): Promise<void> {
    this.notifications.push(message);
  }
}

describe('auction email notifications', () => {
  let stopReplicaSet: (() => Promise<void>) | undefined;
  let engine: AuctionEngine;
  let notifications: AuctionNotificationService;
  const { Auction, Bid } = createAuctionModels(mongoose.connection);
  const Listing = createListingModel(mongoose.connection);
  const User = createUserModel(mongoose.connection);
  const MailOutbox = createMailOutboxModel(mongoose.connection);
  const HandoverSecret = createHandoverSecretModel(mongoose.connection);

  beforeAll(async () => {
    const replicaSet = await startMongoReplicaSet();
    stopReplicaSet = async () => {
      await replicaSet.stop();
    };
    await mongoose.connect(replicaSet.getUri(), { maxPoolSize: 100 });
    engine = createAuctionEngine({ connection: mongoose.connection });
    notifications = new AuctionNotificationService(
      mongoose.connection,
      outboxKey,
      process.env.JWT_SECRET ?? '',
    );
    await Promise.all([
      engine.ensureIndexes(),
      Listing.init(),
      User.init(),
      MailOutbox.init(),
      HandoverSecret.init(),
    ]);
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await stopReplicaSet?.();
  });

  it('queues each outbid and terminal notification once with encrypted recipients', async () => {
    const collegeId = new Types.ObjectId();
    const sellerId = new Types.ObjectId();
    const firstBidderId = new Types.ObjectId();
    const winnerId = new Types.ObjectId();
    const auctionId = new Types.ObjectId();
    const listingId = new Types.ObjectId();
    const firstBidId = new Types.ObjectId();
    const winningBidId = new Types.ObjectId();
    const endsAt = new Date(Date.now() + 60_000);
    await User.create([
      {
        _id: sellerId,
        email: 'seller@bmsce.example',
        passwordHash: 'not-used',
        collegeId,
        roles: ['SELLER'],
        status: 'active',
        emailVerifiedAt: new Date(),
        name: 'Seller Student',
      },
      {
        _id: firstBidderId,
        email: 'previous-bidder@bmsce.example',
        passwordHash: 'not-used',
        collegeId,
        roles: ['BUYER'],
        status: 'active',
        emailVerifiedAt: new Date(),
        name: 'Previous Bidder',
      },
      {
        _id: winnerId,
        email: 'winner@bmsce.example',
        passwordHash: 'not-used',
        collegeId,
        roles: ['BUYER'],
        status: 'active',
        emailVerifiedAt: new Date(),
        name: 'Winning Bidder',
      },
    ]);
    await Listing.create({
      _id: listingId,
      collegeId,
      sellerId,
      title: 'Engineering Mathematics Textbook',
      description: 'A well-kept campus textbook.',
      category: 'textbooks',
      condition: 'good',
      photos: [],
    });
    const baseAuction = {
      _id: auctionId,
      collegeId,
      sellerId,
      listingId,
      status: 'active' as const,
      startPricePaise: 10_000,
      currentPricePaise: 12_000,
      minIncrementPaise: 1_000,
      startsAt: new Date(Date.now() - 60_000),
      endsAt,
      version: 2,
      currentBidId: winningBidId,
      winnerBidId: winningBidId,
      extensionCount: 0,
    };
    await Auction.create(baseAuction);
    const firstBid = {
      _id: firstBidId,
      auctionId,
      collegeId,
      bidderId: firstBidderId,
      amountPaise: 10_000,
      idemKey: 'first-bid',
      createdAt: new Date(Date.now() - 2_000),
      auctionSnapshot: {
        ...baseAuction,
        version: 1,
        currentPricePaise: 10_000,
        currentBidId: firstBidId,
        winnerBidId: null,
      },
    };
    const winningBid: BidRecord = {
      _id: winningBidId,
      auctionId,
      collegeId,
      bidderId: winnerId,
      amountPaise: 12_000,
      idemKey: 'winning-bid',
      createdAt: new Date(Date.now() - 1_000),
      auctionSnapshot: {
        ...baseAuction,
        version: 2,
        currentPricePaise: 12_000,
        currentBidId: winningBidId,
        winnerBidId: null,
      },
    };
    await Bid.create([firstBid, winningBid]);

    await notifications.handleBid(winningBid);
    await notifications.handleBid(winningBid);
    await Auction.updateOne({ _id: auctionId }, { $set: { status: 'ended' } });
    await notifications.handleAuctionStatus(auctionId, 'ended');
    await notifications.handleAuctionStatus(auctionId, 'ended');

    const jobs = await MailOutbox.find().sort({ dedupeKey: 1 }).lean().exec();
    expect(jobs.map((job) => job.kind).sort()).toEqual([
      'auction-outbid',
      'auction-sold',
      'auction-won',
    ]);
    expect(jobs).toHaveLength(3);
    expect(
      jobs.every((job) => !job.encryptedPayload?.includes('@bmsce.example')),
    ).toBe(true);
    const outbid = jobs.find((job) => job.kind === 'auction-outbid');
    if (!outbid?.encryptedPayload)
      throw new Error('Missing outbid job payload');
    expect(
      decryptMailPayload(outbid.encryptedPayload, outboxKey),
    ).toMatchObject({
      kind: 'auction-outbid',
      to: 'previous-bidder@bmsce.example',
      amountPaise: 12_000,
    });

    const provider = new RecordingProvider();
    const worker = new MailOutboxWorker(MailOutbox, provider, outboxKey, {
      error: () => undefined,
    });
    expect(await worker.processBatch()).toBe(3);
    expect(
      provider.notifications.map((message) => message.kind).sort(),
    ).toEqual(['auction-outbid', 'auction-sold', 'auction-won']);
    expect(
      provider.notifications.find((message) => message.kind === 'auction-won'),
    ).toMatchObject({
      to: 'winner@bmsce.example',
      amountPaise: 12_000,
      handoverCode: expect.stringMatching(/^\d{6}$/),
    });
    const wonEmail = provider.notifications.find(
      (message) => message.kind === 'auction-won',
    );
    const handoverSecret = await HandoverSecret.findOne({ auctionId })
      .select('+encryptedCode')
      .lean()
      .exec();
    expect(handoverSecret?.encryptedCode).toBeTruthy();
    expect(
      decryptHandoverCode(handoverSecret?.encryptedCode ?? '', outboxKey),
    ).toBe(
      wonEmail?.kind === 'auction-won' ? wonEmail.handoverCode : undefined,
    );
  });

  it('queues an unsold notification to the seller once', async () => {
    const collegeId = new Types.ObjectId();
    const sellerId = new Types.ObjectId();
    const auctionId = new Types.ObjectId();
    const listingId = new Types.ObjectId();
    await User.create({
      _id: sellerId,
      email: 'unsold-seller@bmsce.example',
      passwordHash: 'not-used',
      collegeId,
      roles: ['SELLER'],
      status: 'active',
      emailVerifiedAt: new Date(),
      name: 'Seller Student',
    });
    await Listing.create({
      _id: listingId,
      collegeId,
      sellerId,
      title: 'Scientific Calculator',
      description: 'Calculator with no bids.',
      category: 'calculators',
      condition: 'good',
      photos: [],
    });
    await Auction.create({
      _id: auctionId,
      collegeId,
      sellerId,
      listingId,
      status: 'unsold',
      startPricePaise: 10_000,
      currentPricePaise: 10_000,
      minIncrementPaise: 100,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() - 1_000),
      version: 2,
      currentBidId: null,
      winnerBidId: null,
      extensionCount: 0,
    });

    await notifications.handleAuctionStatus(auctionId, 'unsold');
    await notifications.handleAuctionStatus(auctionId, 'unsold');
    const job = await MailOutbox.findOne({
      dedupeKey: `auction:${auctionId.toString()}:unsold`,
    })
      .lean()
      .exec();
    expect(job?.kind).toBe('auction-unsold');
    expect(job?.encryptedPayload).toBeTruthy();
  });
});
