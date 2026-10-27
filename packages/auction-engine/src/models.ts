import { Schema, type Connection, type Model } from 'mongoose';
import type { AuctionFields, BidFields } from './types.js';

const isNonNegativePaise = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const isPositivePaise = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

export const auctionSchema = new Schema<AuctionFields>(
  {
    collegeId: { type: Schema.Types.ObjectId, required: true },
    sellerId: { type: Schema.Types.ObjectId, required: true },
    listingId: { type: Schema.Types.ObjectId, required: true },
    status: {
      type: String,
      enum: [
        'draft',
        'scheduled',
        'active',
        'ended',
        'paid',
        'unsold',
        'cancelled',
      ],
      required: true,
      default: 'draft',
    },
    startPricePaise: {
      type: Number,
      required: true,
      validate: {
        validator: isNonNegativePaise,
        message: 'Must be integer paise',
      },
    },
    currentPricePaise: {
      type: Number,
      required: true,
      validate: {
        validator: isNonNegativePaise,
        message: 'Must be integer paise',
      },
    },
    minIncrementPaise: {
      type: Number,
      required: true,
      validate: {
        validator: isPositivePaise,
        message: 'Must be positive integer paise',
      },
    },
    reservePricePaise: {
      type: Number,
      validate: {
        validator: isNonNegativePaise,
        message: 'Must be integer paise',
      },
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    version: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: isNonNegativePaise,
        message: 'Must be a non-negative integer',
      },
    },
    currentBidId: { type: Schema.Types.ObjectId, ref: 'Bid', default: null },
    winnerBidId: { type: Schema.Types.ObjectId, ref: 'Bid', default: null },
    extensionCount: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: isNonNegativePaise,
        message: 'Must be a non-negative integer',
      },
    },
  },
  { collection: 'auctions', versionKey: false },
);

auctionSchema.index(
  { status: 1, endsAt: 1 },
  { name: 'auction_status_endsAt' },
);
auctionSchema.index(
  { collegeId: 1, status: 1 },
  { name: 'auction_college_status' },
);
auctionSchema.index(
  { status: 1, startsAt: 1 },
  { name: 'auction_status_startsAt' },
);

export const bidSchema = new Schema<BidFields>(
  {
    auctionId: { type: Schema.Types.ObjectId, required: true, ref: 'Auction' },
    collegeId: { type: Schema.Types.ObjectId, required: true },
    bidderId: { type: Schema.Types.ObjectId, required: true },
    amountPaise: {
      type: Number,
      required: true,
      validate: {
        validator: isNonNegativePaise,
        message: 'Must be integer paise',
      },
    },
    idemKey: { type: String, required: true, minlength: 1, maxlength: 200 },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
    auctionSnapshot: {
      _id: { type: Schema.Types.ObjectId, required: true },
      collegeId: { type: Schema.Types.ObjectId, required: true },
      sellerId: { type: Schema.Types.ObjectId, required: true },
      listingId: { type: Schema.Types.ObjectId, required: true },
      status: { type: String, required: true },
      startPricePaise: { type: Number, required: true },
      currentPricePaise: { type: Number, required: true },
      minIncrementPaise: { type: Number, required: true },
      reservePricePaise: { type: Number },
      startsAt: { type: Date, required: true },
      endsAt: { type: Date, required: true },
      version: { type: Number, required: true },
      currentBidId: { type: Schema.Types.ObjectId, default: null },
      winnerBidId: { type: Schema.Types.ObjectId, default: null },
      extensionCount: { type: Number, required: true },
    },
  },
  { collection: 'bids', versionKey: false },
);

bidSchema.index(
  { auctionId: 1, bidderId: 1, idemKey: 1 },
  { unique: true, name: 'bid_idempotency_per_bidder' },
);
bidSchema.index(
  { auctionId: 1, amountPaise: 1 },
  { unique: true, name: 'bid_amount_once_per_auction' },
);
bidSchema.index(
  { auctionId: 1, createdAt: 1 },
  { name: 'bid_auction_createdAt' },
);

export interface AuctionModels {
  Auction: Model<AuctionFields>;
  Bid: Model<BidFields>;
}

export function createAuctionModels(connection: Connection): AuctionModels {
  const Auction =
    (connection.models.Auction as Model<AuctionFields> | undefined) ??
    connection.model<AuctionFields>('Auction', auctionSchema);
  const Bid =
    (connection.models.Bid as Model<BidFields> | undefined) ??
    connection.model<BidFields>('Bid', bidSchema);

  return { Auction, Bid };
}

const rejectBidMutation = function (): never {
  throw new Error('Bid records are append-only');
};

bidSchema.pre('save', function () {
  if (!this.isNew) rejectBidMutation();
});
for (const operation of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
  'replaceOne',
] as const) {
  bidSchema.pre(operation, rejectBidMutation);
}
