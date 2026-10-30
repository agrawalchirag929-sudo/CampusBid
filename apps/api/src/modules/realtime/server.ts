import type {
  AuctionDetail,
  AuctionReplayAck,
  AuthContext,
  BidPlacedEvent,
  RealtimeClientToServerEvents,
  RealtimeServerToClientEvents,
} from '@campusbid/shared';
import type { AuctionEngine, BidRecord } from '@campusbid/auction-engine';
import { Server, type Socket } from 'socket.io';
import { Types, type Connection } from 'mongoose';
import type { Server as HttpServer } from 'node:http';
import pino from 'pino';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import { verifyAccessToken } from '../auth/access-token.js';
import { UserRepository } from '../users/repository.js';
import { AuctionsService } from '../auctions/service.js';
import { ScopedResourceNotFoundError } from '../colleges/scope.js';
import {
  joinAuctionPayloadSchema,
  leaveAuctionPayloadSchema,
  replayAuctionPayloadSchema,
} from '@campusbid/shared';
import {
  AuctionChangeStream,
  auctionStatusFromChange,
  type RealtimeChange,
} from './change-stream.js';

const MAX_ROOMS_PER_SOCKET = 20;
const MAX_REPLAY_BIDS = 50;
const handshakeAuthSchema = z
  .object({ accessToken: z.string().min(1).max(8_192) })
  .strict();

interface SocketData {
  auth: AuthContext;
  expiresAt: number;
}

type CampusSocket = Socket<
  RealtimeClientToServerEvents,
  RealtimeServerToClientEvents,
  Record<string, never>,
  SocketData
>;

interface BidderFirstRow {
  _id: Types.ObjectId;
  firstVersion: number;
}

interface RealtimeLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

export interface RealtimeServerOptions {
  httpServer: HttpServer;
  connection: Connection;
  engine: AuctionEngine;
  config: AppConfig;
  clock?: () => Date;
  logger?: RealtimeLogger;
}

export interface RealtimeServerHandle {
  io: Server<
    RealtimeClientToServerEvents,
    RealtimeServerToClientEvents,
    Record<string, never>,
    SocketData
  >;
  start(): void;
  restartChangeStream(): Promise<void>;
  close(): Promise<void>;
}

function roomName(auctionId: string): string {
  return `auction:${auctionId.toLowerCase()}`;
}

function toStateEvent(
  snapshot: AuctionDetail,
  serverTime: string,
): Parameters<RealtimeServerToClientEvents['auction.state']>[0] {
  return {
    type: 'auction.state',
    auctionId: snapshot.id,
    version: snapshot.version,
    serverTime,
    snapshot: { ...snapshot, serverTime },
  };
}

function safeAuctionId(value: Types.ObjectId): string {
  return value.toString();
}

export function createRealtimeServer(
  options: RealtimeServerOptions,
): RealtimeServerHandle {
  const logger = options.logger ?? pino({ level: 'silent' });
  const clock = options.clock ?? (() => new Date());
  const users = new UserRepository(options.connection);
  const auctions = new AuctionsService(
    options.connection,
    options.engine,
    options.config,
    clock,
  );
  const Bid = options.engine.models.Bid;
  const io = new Server<
    RealtimeClientToServerEvents,
    RealtimeServerToClientEvents,
    Record<string, never>,
    SocketData
  >(options.httpServer, {
    cors: { origin: options.config.CORS_ORIGINS, credentials: true },
  });
  const joinedRooms = new Map<string, Set<string>>();

  const stateFor = async (
    auctionId: string,
    collegeId: string,
  ): Promise<Parameters<RealtimeServerToClientEvents['auction.state']>[0]> => {
    const snapshot = await auctions.realtimeState(auctionId, collegeId);
    return toStateEvent(snapshot, clock().toISOString());
  };

  const publishViewerCount = (auctionId: string): void => {
    const room = roomName(auctionId);
    io.to(room).emit('room.viewers', {
      type: 'room.viewers',
      auctionId,
      viewers: io.sockets.adapter.rooms.get(room)?.size ?? 0,
      serverTime: clock().toISOString(),
    });
  };

  const maskedBidderLabel = async (
    auctionId: Types.ObjectId,
    collegeId: Types.ObjectId,
    bidderId: Types.ObjectId,
    throughVersion: number,
  ): Promise<string> => {
    const firstBidders = await Bid.aggregate<BidderFirstRow>([
      {
        $match: {
          auctionId,
          collegeId,
          'auctionSnapshot.version': { $lte: throughVersion },
        },
      },
      { $sort: { 'auctionSnapshot.version': 1 } },
      {
        $group: {
          _id: '$bidderId',
          firstVersion: { $first: '$auctionSnapshot.version' },
        },
      },
      { $sort: { firstVersion: 1, _id: 1 } },
    ]).exec();
    const index = firstBidders.findIndex(
      (bidder) => bidder._id.toString() === bidderId.toString(),
    );
    return index < 0 ? 'Bidder' : `Bidder ${String(index + 1)}`;
  };

  const toBidEvent = async (bid: BidRecord): Promise<BidPlacedEvent> => {
    const version = bid.auctionSnapshot.version;
    const [previousBid, bidCount, bidderLabel] = await Promise.all([
      Bid.findOne({
        auctionId: bid.auctionId,
        'auctionSnapshot.version': { $lt: version },
      })
        .sort({ 'auctionSnapshot.version': -1 })
        .select({ auctionSnapshot: 1 })
        .lean()
        .exec(),
      Bid.countDocuments({
        auctionId: bid.auctionId,
        collegeId: bid.collegeId,
        'auctionSnapshot.version': { $lte: version },
      }).exec(),
      maskedBidderLabel(bid.auctionId, bid.collegeId, bid.bidderId, version),
    ]);
    return {
      type: 'bid.placed',
      auctionId: safeAuctionId(bid.auctionId),
      bidId: bid._id.toString(),
      amountPaise: bid.amountPaise,
      bidderLabel,
      version,
      endsAt: bid.auctionSnapshot.endsAt.toISOString(),
      bidCount,
      extended:
        bid.auctionSnapshot.extensionCount >
        (previousBid?.auctionSnapshot.extensionCount ?? 0),
      serverTime: clock().toISOString(),
    };
  };

  const handleBidInsert = async (change: RealtimeChange): Promise<void> => {
    const bid = change.fullDocument;
    if (!bid || change.ns?.coll !== 'bids') return;
    const id = safeAuctionId(bid.auctionId);
    if (!io.sockets.adapter.rooms.has(roomName(id))) return;
    const event = await toBidEvent(bid as BidRecord);
    io.to(roomName(id)).emit('bid.placed', event);
  };

  const handleAuctionStatus = async (change: RealtimeChange): Promise<void> => {
    const update = auctionStatusFromChange(change);
    if (!update) return;
    const auctionId = safeAuctionId(update.auctionId);
    const room = roomName(auctionId);
    if (!io.sockets.adapter.rooms.has(room)) return;
    const base = {
      auctionId,
      version: update.version,
      serverTime: clock().toISOString(),
    };
    switch (update.status) {
      case 'active':
        io.to(room).emit('auction.activated', {
          type: 'auction.activated',
          ...base,
        });
        return;
      case 'ended': {
        const winnerBidId =
          change.updateDescription?.updatedFields?.winnerBidId;
        if (!(winnerBidId instanceof Types.ObjectId)) return;
        const winningBid = await Bid.findOne({
          _id: winnerBidId,
          auctionId: update.auctionId,
        })
          .lean()
          .exec();
        if (!winningBid) return;
        const winnerLabel = await maskedBidderLabel(
          winningBid.auctionId,
          winningBid.collegeId,
          winningBid.bidderId,
          winningBid.auctionSnapshot.version,
        );
        io.to(room).emit('auction.ended', {
          type: 'auction.ended',
          ...base,
          winnerLabel,
        });
        return;
      }
      case 'unsold':
        io.to(room).emit('auction.unsold', {
          type: 'auction.unsold',
          ...base,
        });
        return;
      case 'cancelled':
        io.to(room).emit('auction.cancelled', {
          type: 'auction.cancelled',
          ...base,
        });
        return;
      default:
        return;
    }
  };

  const stream = new AuctionChangeStream(
    options.connection,
    async (change) => {
      if (change.operationType === 'insert') await handleBidInsert(change);
      else await handleAuctionStatus(change);
    },
    async () => {
      for (const name of io.sockets.adapter.rooms.keys()) {
        if (!name.startsWith('auction:')) continue;
        const auctionId = name.slice('auction:'.length);
        const socketId = io.sockets.adapter.rooms
          .get(name)
          ?.values()
          .next().value;
        const socket = socketId ? io.sockets.sockets.get(socketId) : undefined;
        if (!socket) continue;
        try {
          const state = await stateFor(auctionId, socket.data.auth.collegeId);
          io.to(name).emit('auction.resync', {
            type: 'auction.resync',
            auctionId,
            version: state.version,
            serverTime: clock().toISOString(),
          });
        } catch (error) {
          logger.error({ err: error, auctionId }, 'Auction resync emit failed');
        }
      }
    },
    logger,
  );

  io.use(async (socket, next) => {
    const parsed = handshakeAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      next(new Error('Unauthorized'));
      return;
    }
    const token = await verifyAccessToken(
      parsed.data.accessToken,
      options.config,
    );
    if (!token) {
      next(new Error('Unauthorized'));
      return;
    }
    try {
      const user = await users.findAuthenticatedUser(
        token.userId,
        token.collegeId,
      );
      if (!user) {
        next(new Error('Unauthorized'));
        return;
      }
      socket.data.auth = {
        userId: user._id.toString(),
        collegeId: user.collegeId.toString(),
        roles: [...user.roles],
      };
      socket.data.expiresAt = token.expiresAt.getTime();
      next();
    } catch (error) {
      logger.error({ err: error }, 'Socket user lookup failed');
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket: CampusSocket) => {
    const expirationTimer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.expiresAt - Date.now()),
    );
    expirationTimer.unref();
    joinedRooms.set(socket.id, new Set());

    socket.on('auction.join', (payload, acknowledge) => {
      const parsed = joinAuctionPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        acknowledge({ ok: false, error: 'INVALID_PAYLOAD' });
        return;
      }
      void (async () => {
        const auctionId = parsed.data.auctionId.toLowerCase();
        const room = roomName(auctionId);
        const rooms = joinedRooms.get(socket.id);
        if (!rooms) {
          acknowledge({ ok: false, error: 'NOT_FOUND' });
          return;
        }
        if (!rooms.has(room) && rooms.size >= MAX_ROOMS_PER_SOCKET) {
          acknowledge({ ok: false, error: 'ROOM_LIMIT' });
          return;
        }
        try {
          await auctions.realtimeState(auctionId, socket.data.auth.collegeId);
        } catch (error) {
          if (error instanceof ScopedResourceNotFoundError) {
            acknowledge({ ok: false, error: 'NOT_FOUND' });
            return;
          }
          throw error;
        }
        await socket.join(room);
        rooms.add(room);
        let state: Awaited<ReturnType<typeof stateFor>>;
        try {
          state = await stateFor(auctionId, socket.data.auth.collegeId);
        } catch (error) {
          rooms.delete(room);
          await socket.leave(room);
          throw error;
        }
        socket.emit('auction.state', state);
        acknowledge({ ok: true, state });
        publishViewerCount(auctionId);
      })().catch((error: unknown) => {
        logger.error({ err: error }, 'Socket auction join failed');
        acknowledge({ ok: false, error: 'NOT_FOUND' });
      });
    });

    socket.on('auction.leave', (payload, acknowledge) => {
      const parsed = leaveAuctionPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        acknowledge({ ok: false, error: 'INVALID_PAYLOAD' });
        return;
      }
      const auctionId = parsed.data.auctionId.toLowerCase();
      const room = roomName(auctionId);
      const rooms = joinedRooms.get(socket.id);
      if (!rooms?.has(room)) {
        acknowledge({ ok: false, error: 'NOT_JOINED' });
        return;
      }
      rooms.delete(room);
      void Promise.resolve(socket.leave(room))
        .then(() => {
          acknowledge({ ok: true });
          publishViewerCount(auctionId);
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Socket auction leave failed');
          acknowledge({ ok: false, error: 'NOT_JOINED' });
        });
    });

    socket.on('auction.replay', (payload, acknowledge) => {
      const parsed = replayAuctionPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        acknowledge({ ok: false, error: 'INVALID_PAYLOAD' });
        return;
      }
      const auctionId = parsed.data.auctionId.toLowerCase();
      if (!joinedRooms.get(socket.id)?.has(roomName(auctionId))) {
        acknowledge({ ok: false, error: 'NOT_JOINED' });
        return;
      }
      void (async (): Promise<AuctionReplayAck> => {
        const currentState = await stateFor(
          auctionId,
          socket.data.auth.collegeId,
        );
        const lastSeenVersion = parsed.data.lastSeenVersion;
        if (lastSeenVersion === currentState.version) {
          return { ok: true, mode: 'events', events: [] };
        }
        const auctionObjectId = new Types.ObjectId(auctionId);
        const bids = await Bid.find({
          auctionId: auctionObjectId,
          collegeId: new Types.ObjectId(socket.data.auth.collegeId),
          'auctionSnapshot.version': { $gt: lastSeenVersion },
        })
          .sort({ 'auctionSnapshot.version': 1 })
          .limit(MAX_REPLAY_BIDS + 1)
          .lean()
          .exec();
        if (bids.length > MAX_REPLAY_BIDS)
          return { ok: true, mode: 'state', state: currentState };

        const previousBid = await Bid.findOne({
          auctionId: auctionObjectId,
          collegeId: new Types.ObjectId(socket.data.auth.collegeId),
          'auctionSnapshot.version': { $lte: lastSeenVersion },
        })
          .sort({ 'auctionSnapshot.version': -1 })
          .select({ auctionSnapshot: 1 })
          .lean()
          .exec();
        let priorExtensionCount =
          previousBid?.auctionSnapshot.extensionCount ?? 0;
        let expectedVersion = lastSeenVersion;
        const events: BidPlacedEvent[] = [];
        for (const bid of bids) {
          const extended =
            bid.auctionSnapshot.extensionCount > priorExtensionCount;
          const expectedBidVersion = expectedVersion + (extended ? 2 : 1);
          if (bid.auctionSnapshot.version !== expectedBidVersion)
            return { ok: true, mode: 'state', state: currentState };
          const event = await toBidEvent(bid as BidRecord);
          events.push(event);
          expectedVersion = bid.auctionSnapshot.version;
          priorExtensionCount = bid.auctionSnapshot.extensionCount;
        }
        if (expectedVersion !== currentState.version)
          return { ok: true, mode: 'state', state: currentState };
        return { ok: true, mode: 'events', events };
      })()
        .then(acknowledge)
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Socket auction replay failed');
          acknowledge({ ok: false, error: 'NOT_FOUND' });
        });
    });

    socket.on('disconnect', () => {
      clearTimeout(expirationTimer);
      const rooms = joinedRooms.get(socket.id);
      joinedRooms.delete(socket.id);
      for (const room of rooms ?? []) {
        const auctionId = room.slice('auction:'.length);
        publishViewerCount(auctionId);
      }
    });
  });

  return {
    io,
    start: () => stream.start(),
    restartChangeStream: () => stream.restart(),
    close: async () => {
      await stream.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
