import type { AuctionStatus } from './types.js';

const ALLOWED_TRANSITIONS: Record<AuctionStatus, readonly AuctionStatus[]> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['active', 'cancelled'],
  active: ['ended', 'cancelled'],
  ended: ['paid', 'unsold', 'cancelled'],
  paid: [],
  unsold: [],
  cancelled: [],
};

export class InvalidAuctionTransitionError extends Error {
  constructor(
    readonly from: AuctionStatus,
    readonly to: AuctionStatus,
  ) {
    super(`Illegal auction transition: ${from} -> ${to}`);
    this.name = 'InvalidAuctionTransitionError';
  }
}

export function assertAuctionTransition(
  from: AuctionStatus,
  to: AuctionStatus,
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidAuctionTransitionError(from, to);
  }
}
