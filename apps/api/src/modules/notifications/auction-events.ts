import type { Types, Connection, Model } from 'mongoose';
import type {
  AuctionFields,
  BidFields,
  BidRecord,
} from '@campusbid/auction-engine';
import { createAuctionModels } from '@campusbid/auction-engine';
import { createListingModel, type ListingFields } from '../listings/model.js';
import { createUserModel, type UserFields } from '../users/model.js';
import { MailOutboxRepository } from './repository.js';

interface MailRecipient {
  _id: Types.ObjectId;
  email: string;
  name: string;
}

export class AuctionNotificationService {
  private readonly Auction: Model<AuctionFields>;
  private readonly Bid: Model<BidFields>;
  private readonly Listing: Model<ListingFields>;
  private readonly User: Model<UserFields>;
  private readonly mailOutbox: MailOutboxRepository;

  constructor(connection: Connection, encryptionSecret: string) {
    const auctionModels = createAuctionModels(connection);
    this.Auction = auctionModels.Auction;
    this.Bid = auctionModels.Bid;
    this.Listing = createListingModel(connection);
    this.User = createUserModel(connection);
    this.mailOutbox = new MailOutboxRepository(connection, encryptionSecret);
  }

  async handleBid(bid: BidRecord): Promise<void> {
    const previousBid = await this.Bid.findOne({
      auctionId: bid.auctionId,
      collegeId: bid.collegeId,
      'auctionSnapshot.version': { $lt: bid.auctionSnapshot.version },
    })
      .sort({ 'auctionSnapshot.version': -1 })
      .lean()
      .exec();
    if (!previousBid || previousBid.bidderId.equals(bid.bidderId)) return;

    const [auction, recipient] = await Promise.all([
      this.Auction.findOne({
        _id: bid.auctionId,
        collegeId: bid.collegeId,
      })
        .lean()
        .exec(),
      this.findRecipient(previousBid.bidderId, bid.collegeId),
    ]);
    if (!auction || !recipient) return;
    const listing = await this.Listing.findOne({
      _id: auction.listingId,
      collegeId: bid.collegeId,
    })
      .select({ title: 1 })
      .lean()
      .exec();
    if (!listing) return;

    await this.mailOutbox.enqueueAuctionNotificationEmail(
      {
        kind: 'auction-outbid',
        to: recipient.email,
        name: recipient.name,
        auctionTitle: listing.title,
        amountPaise: bid.amountPaise,
      },
      { userId: recipient._id, collegeId: bid.collegeId },
      `bid:${bid._id.toString()}:outbid`,
    );
  }

  async handleAuctionStatus(
    auctionId: Types.ObjectId,
    status: 'ended' | 'unsold',
  ): Promise<void> {
    const auction = await this.Auction.findOne({ _id: auctionId })
      .lean()
      .exec();
    if (!auction) return;
    const listing = await this.Listing.findOne({
      _id: auction.listingId,
      collegeId: auction.collegeId,
    })
      .select({ title: 1 })
      .lean()
      .exec();
    if (!listing) return;

    const seller = await this.findRecipient(
      auction.sellerId,
      auction.collegeId,
    );
    if (!seller) return;
    if (status === 'unsold' || !auction.winnerBidId) {
      if (status === 'unsold') {
        await this.mailOutbox.enqueueAuctionNotificationEmail(
          {
            kind: 'auction-unsold',
            to: seller.email,
            name: seller.name,
            auctionTitle: listing.title,
          },
          { userId: seller._id, collegeId: auction.collegeId },
          `auction:${auctionId.toString()}:unsold`,
        );
      }
      return;
    }

    const winnerBid = await this.Bid.findOne({
      _id: auction.winnerBidId,
      auctionId,
      collegeId: auction.collegeId,
    })
      .lean()
      .exec();
    if (!winnerBid) return;
    const winner = await this.findRecipient(
      winnerBid.bidderId,
      auction.collegeId,
    );
    if (!winner) return;

    await Promise.all([
      this.mailOutbox.enqueueAuctionNotificationEmail(
        {
          kind: 'auction-won',
          to: winner.email,
          name: winner.name,
          auctionTitle: listing.title,
          amountPaise: winnerBid.amountPaise,
        },
        { userId: winner._id, collegeId: auction.collegeId },
        `auction:${auctionId.toString()}:won`,
      ),
      this.mailOutbox.enqueueAuctionNotificationEmail(
        {
          kind: 'auction-sold',
          to: seller.email,
          name: seller.name,
          auctionTitle: listing.title,
          amountPaise: winnerBid.amountPaise,
        },
        { userId: seller._id, collegeId: auction.collegeId },
        `auction:${auctionId.toString()}:sold`,
      ),
    ]);
  }

  private async findRecipient(
    userId: Types.ObjectId,
    collegeId: Types.ObjectId,
  ): Promise<MailRecipient | null> {
    return this.User.findOne({ _id: userId, collegeId })
      .select({ email: 1, name: 1 })
      .lean<MailRecipient>()
      .exec();
  }
}
