import type { AuctionFields } from './types.js';

export function minimumNextBidPaise(
  auction: Pick<
    AuctionFields,
    | 'currentBidId'
    | 'currentPricePaise'
    | 'minIncrementPaise'
    | 'startPricePaise'
  >,
): number {
  return auction.currentBidId === null
    ? auction.startPricePaise
    : auction.currentPricePaise + auction.minIncrementPaise;
}

export function isValidPaise(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
