import { z } from 'zod';
import { auctionDetailSchema } from './auctions.js';

const objectIdSchema = z.string().regex(/^[\da-f]{24}$/i);
const eventBaseSchema = z.object({
  auctionId: objectIdSchema,
  version: z.number().int().nonnegative(),
  serverTime: z.string().datetime(),
});

export const auctionStateEventSchema = z
  .object({
    type: z.literal('auction.state'),
    auctionId: objectIdSchema,
    version: z.number().int().nonnegative(),
    serverTime: z.string().datetime(),
    snapshot: auctionDetailSchema,
  })
  .strict();
export type AuctionStateEvent = z.infer<typeof auctionStateEventSchema>;

export const bidPlacedEventSchema = z
  .object({
    type: z.literal('bid.placed'),
    auctionId: objectIdSchema,
    bidId: objectIdSchema,
    amountPaise: z.number().int().nonnegative(),
    bidderLabel: z.string().min(1),
    version: z.number().int().nonnegative(),
    endsAt: z.string().datetime(),
    bidCount: z.number().int().nonnegative(),
    extended: z.boolean(),
    serverTime: z.string().datetime(),
  })
  .strict();
export type BidPlacedEvent = z.infer<typeof bidPlacedEventSchema>;

export const auctionActivatedEventSchema = eventBaseSchema
  .extend({ type: z.literal('auction.activated') })
  .strict();
export type AuctionActivatedEvent = z.infer<typeof auctionActivatedEventSchema>;

export const auctionEndedEventSchema = eventBaseSchema
  .extend({
    type: z.literal('auction.ended'),
    winnerLabel: z.string().min(1),
  })
  .strict();
export type AuctionEndedEvent = z.infer<typeof auctionEndedEventSchema>;

export const auctionUnsoldEventSchema = eventBaseSchema
  .extend({ type: z.literal('auction.unsold') })
  .strict();
export type AuctionUnsoldEvent = z.infer<typeof auctionUnsoldEventSchema>;

export const auctionCancelledEventSchema = eventBaseSchema
  .extend({ type: z.literal('auction.cancelled') })
  .strict();
export type AuctionCancelledEvent = z.infer<typeof auctionCancelledEventSchema>;

export const roomViewersEventSchema = z
  .object({
    type: z.literal('room.viewers'),
    auctionId: objectIdSchema,
    viewers: z.number().int().nonnegative(),
    serverTime: z.string().datetime(),
  })
  .strict();
export type RoomViewersEvent = z.infer<typeof roomViewersEventSchema>;

export const auctionResyncEventSchema = z
  .object({
    type: z.literal('auction.resync'),
    auctionId: objectIdSchema,
    version: z.number().int().nonnegative(),
    serverTime: z.string().datetime(),
  })
  .strict();
export type AuctionResyncEvent = z.infer<typeof auctionResyncEventSchema>;

export const realtimeServerEventSchema = z.discriminatedUnion('type', [
  auctionStateEventSchema,
  bidPlacedEventSchema,
  auctionActivatedEventSchema,
  auctionEndedEventSchema,
  auctionUnsoldEventSchema,
  auctionCancelledEventSchema,
  roomViewersEventSchema,
  auctionResyncEventSchema,
]);
export type RealtimeServerEvent = z.infer<typeof realtimeServerEventSchema>;

export const joinAuctionPayloadSchema = z
  .object({ auctionId: objectIdSchema })
  .strict();
export type JoinAuctionPayload = z.infer<typeof joinAuctionPayloadSchema>;

export const leaveAuctionPayloadSchema = joinAuctionPayloadSchema;
export type LeaveAuctionPayload = z.infer<typeof leaveAuctionPayloadSchema>;

export const replayAuctionPayloadSchema = z
  .object({
    auctionId: objectIdSchema,
    lastSeenVersion: z.number().int().nonnegative(),
  })
  .strict();
export type ReplayAuctionPayload = z.infer<typeof replayAuctionPayloadSchema>;

export interface AuctionRoomAckSuccess {
  ok: true;
  state: AuctionStateEvent;
}
export interface AuctionRoomAckFailure {
  ok: false;
  error: 'NOT_FOUND' | 'ROOM_LIMIT' | 'INVALID_PAYLOAD';
}
export type AuctionRoomAck = AuctionRoomAckSuccess | AuctionRoomAckFailure;

export type AuctionReplayAck =
  | { ok: true; mode: 'events'; events: BidPlacedEvent[] }
  | { ok: true; mode: 'state'; state: AuctionStateEvent }
  | { ok: false; error: 'NOT_JOINED' | 'NOT_FOUND' | 'INVALID_PAYLOAD' };

export type AuctionLeaveAck =
  { ok: true } | { ok: false; error: 'NOT_JOINED' | 'INVALID_PAYLOAD' };

export interface RealtimeServerToClientEvents {
  'auction.state': (event: AuctionStateEvent) => void;
  'bid.placed': (event: BidPlacedEvent) => void;
  'auction.activated': (event: AuctionActivatedEvent) => void;
  'auction.ended': (event: AuctionEndedEvent) => void;
  'auction.unsold': (event: AuctionUnsoldEvent) => void;
  'auction.cancelled': (event: AuctionCancelledEvent) => void;
  'room.viewers': (event: RoomViewersEvent) => void;
  'auction.resync': (event: AuctionResyncEvent) => void;
}

export interface RealtimeClientToServerEvents {
  'auction.join': (
    payload: unknown,
    acknowledge: (result: AuctionRoomAck) => void,
  ) => void;
  'auction.leave': (
    payload: unknown,
    acknowledge: (result: AuctionLeaveAck) => void,
  ) => void;
  'auction.replay': (
    payload: unknown,
    acknowledge: (result: AuctionReplayAck) => void,
  ) => void;
}
