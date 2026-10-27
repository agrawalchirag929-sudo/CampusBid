import type { Types } from 'mongoose';

export const AUCTION_STATUSES = [
  'draft',
  'scheduled',
  'active',
  'ended',
  'paid',
  'unsold',
  'cancelled',
] as const;

export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export interface AuctionFields {
  collegeId: Types.ObjectId;
  sellerId: Types.ObjectId;
  listingId: Types.ObjectId;
  status: AuctionStatus;
  startPricePaise: number;
  currentPricePaise: number;
  minIncrementPaise: number;
  reservePricePaise?: number;
  startsAt: Date;
  endsAt: Date;
  version: number;
  currentBidId: Types.ObjectId | null;
  winnerBidId: Types.ObjectId | null;
  extensionCount: number;
}

export interface StoredAuctionSnapshot {
  _id: Types.ObjectId;
  collegeId: Types.ObjectId;
  sellerId: Types.ObjectId;
  listingId: Types.ObjectId;
  status: AuctionStatus;
  startPricePaise: number;
  currentPricePaise: number;
  minIncrementPaise: number;
  reservePricePaise?: number;
  startsAt: Date;
  endsAt: Date;
  version: number;
  currentBidId: Types.ObjectId | null;
  winnerBidId: Types.ObjectId | null;
  extensionCount: number;
}

export type AuctionRecord = AuctionFields & { _id: Types.ObjectId };

export interface BidFields {
  auctionId: Types.ObjectId;
  collegeId: Types.ObjectId;
  bidderId: Types.ObjectId;
  amountPaise: number;
  idemKey: string;
  createdAt: Date;
  auctionSnapshot: StoredAuctionSnapshot;
}

export type BidRecord = BidFields & { _id: Types.ObjectId };

export interface AuctionSnapshot {
  _id: string;
  collegeId: string;
  sellerId: string;
  listingId: string;
  status: AuctionStatus;
  startPricePaise: number;
  currentPricePaise: number;
  minIncrementPaise: number;
  reservePricePaise?: number;
  startsAt: Date;
  endsAt: Date;
  version: number;
  currentBidId: string | null;
  winnerBidId: string | null;
  extensionCount: number;
}

export interface BidReceipt {
  _id: string;
  auctionId: string;
  collegeId: string;
  bidderId: string;
  amountPaise: number;
  idemKey: string;
  createdAt: Date;
}

export interface PlaceBidInput {
  auctionId: string;
  bidderId: string;
  collegeId: string;
  amountPaise: number;
  idemKey: string;
}

export type PlaceBidCode =
  | 'OUTBID'
  | 'TOO_LOW'
  | 'ENDED'
  | 'NOT_ACTIVE'
  | 'SELF_BID'
  | 'WRONG_COLLEGE'
  | 'IDEMPOTENCY_CONFLICT';

export interface PlaceBidFailure {
  ok: false;
  code: PlaceBidCode;
  currentPricePaise: number;
  version: number;
}

export interface PlaceBidSuccess {
  ok: true;
  auction: AuctionSnapshot;
  bid: BidReceipt;
}

export type PlaceBidResult = PlaceBidSuccess | PlaceBidFailure;
