import { describe, expect, it } from 'vitest';
import {
  assertAuctionTransition,
  InvalidAuctionTransitionError,
} from '../src/state-machine.js';

describe('auction state machine', () => {
  it('allows only explicit state transitions', () => {
    expect(() => assertAuctionTransition('draft', 'scheduled')).not.toThrow();
    expect(() => assertAuctionTransition('scheduled', 'active')).not.toThrow();
    expect(() => assertAuctionTransition('active', 'ended')).not.toThrow();
    expect(() => assertAuctionTransition('ended', 'unsold')).not.toThrow();
    expect(() => assertAuctionTransition('ended', 'paid')).not.toThrow();
    expect(() => assertAuctionTransition('draft', 'cancelled')).not.toThrow();
    expect(() =>
      assertAuctionTransition('scheduled', 'cancelled'),
    ).not.toThrow();
    expect(() => assertAuctionTransition('active', 'cancelled')).not.toThrow();
  });

  it('throws a typed error for illegal transitions', () => {
    expect(() => assertAuctionTransition('paid', 'cancelled')).toThrow(
      InvalidAuctionTransitionError,
    );
    expect(() => assertAuctionTransition('draft', 'active')).toThrow(
      InvalidAuctionTransitionError,
    );
    try {
      assertAuctionTransition('draft', 'active');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidAuctionTransitionError);
      expect(error).toMatchObject({ from: 'draft', to: 'active' });
    }
  });
});
