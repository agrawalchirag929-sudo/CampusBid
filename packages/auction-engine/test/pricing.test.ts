import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { minimumNextBidPaise } from '../src/pricing.js';
import type { AuctionFields } from '../src/types.js';

const baseAuction: AuctionFields = {
  collegeId: new Types.ObjectId(),
  sellerId: new Types.ObjectId(),
  listingId: new Types.ObjectId(),
  status: 'active',
  startPricePaise: 50_000,
  currentPricePaise: 50_000,
  minIncrementPaise: 500,
  startsAt: new Date('2026-10-27T00:00:00.000Z'),
  endsAt: new Date('2026-10-27T01:00:00.000Z'),
  version: 0,
  currentBidId: null,
  winnerBidId: null,
  extensionCount: 0,
};

describe('minimum bid pricing', () => {
  it('uses the start price before the first bid', () => {
    expect(minimumNextBidPaise(baseAuction)).toBe(50_000);
  });

  it('adds the minimum increment after a bid', () => {
    expect(
      minimumNextBidPaise({
        ...baseAuction,
        currentBidId: new Types.ObjectId(),
      }),
    ).toBe(50_500);
  });
});
