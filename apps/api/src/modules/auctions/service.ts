import {
  Types,
  type Connection,
  type QueryFilter,
  type PipelineStage,
} from 'mongoose';
import type {
  AuctionEngine,
  AuctionFields,
  AuctionSnapshot,
  BidFields,
} from '@campusbid/auction-engine';
import type {
  AuctionDetail,
  AuctionListItem,
  AuctionPage,
  CreateAuctionResponse,
  ListingPhoto,
  MyAuction,
  MyBid,
  PublicListing,
} from '@campusbid/shared';
import type { AuthContext } from '@campusbid/shared';
import {
  AuthorizationError,
  assertRole,
} from '../../middleware/require-role.js';
import type { AppConfig } from '../../config.js';
import {
  collegeScopedFilter,
  ScopedResourceNotFoundError,
} from '../colleges/scope.js';
import { assertOwner } from '../users/ownership.js';
import { createUserModel, type UserFields } from '../users/model.js';
import {
  createListingModel,
  type ListingFields,
  type ListingPhoto as StoredListingPhoto,
} from '../listings/model.js';
import { AuctionRequestError, InvalidAuctionCursorError } from './errors.js';
import type {
  AuctionListQuery,
  CreateAuctionInput,
  PatchAuctionInput,
} from './schemas.js';

const MIN_AUCTION_DURATION_MS = 10 * 60 * 1_000;
const MAX_AUCTION_DURATION_MS = 14 * 24 * 60 * 60 * 1_000;
const DEFAULT_LIST_STATUSES = ['active', 'scheduled'] as const;

type CursorSort = AuctionListQuery['sort'];
interface CursorPayload {
  sort: CursorSort;
  value: string | number;
  id: string;
}
interface AuctionListRow extends AuctionFields {
  _id: Types.ObjectId;
  listing: ListingFields & { _id: Types.ObjectId };
}
interface FirstBidderRow {
  _id: Types.ObjectId;
  firstBidAt: Date;
}

function toPublicListing(
  listing: ListingFields & { _id: Types.ObjectId },
): PublicListing {
  return {
    title: listing.title,
    description: listing.description,
    category: listing.category,
    condition: listing.condition,
    photos: listing.photos.map((photo) => ({
      url: photo.url,
      publicId: photo.publicId,
    })),
    createdAt: listing.createdAt.toISOString(),
  };
}

function toAuctionListItem(
  auction: AuctionFields & { _id: Types.ObjectId },
  listing: ListingFields & { _id: Types.ObjectId },
): AuctionListItem {
  return {
    id: auction._id.toString(),
    status: auction.status,
    startPricePaise: auction.startPricePaise,
    currentPricePaise: auction.currentPricePaise,
    minIncrementPaise: auction.minIncrementPaise,
    startsAt: auction.startsAt.toISOString(),
    endsAt: auction.endsAt.toISOString(),
    version: auction.version,
    listing: toPublicListing(listing),
  };
}

function toCreateAuctionResponse(
  auction: AuctionFields & { _id: Types.ObjectId },
  listing: ListingFields & { _id: Types.ObjectId },
): CreateAuctionResponse {
  return {
    ...toAuctionListItem(auction, listing),
  };
}

function validateAuctionDates(startsAt: Date, endsAt: Date, now: Date): void {
  if (startsAt.getTime() < now.getTime()) {
    throw new AuctionRequestError(
      400,
      'Auction start time must be in the future',
    );
  }
  const duration = endsAt.getTime() - startsAt.getTime();
  if (
    duration < MIN_AUCTION_DURATION_MS ||
    duration > MAX_AUCTION_DURATION_MS
  ) {
    throw new AuctionRequestError(
      400,
      'Auction duration must be between 10 minutes and 14 days',
    );
  }
}

function validatePhotos(
  photos: readonly ListingPhoto[],
  auth: AuthContext,
  config: AppConfig,
): void {
  if (photos.length === 0) return;
  const cloudName = config.CLOUDINARY_CLOUD_NAME;
  if (
    !cloudName ||
    !config.CLOUDINARY_API_KEY ||
    !config.CLOUDINARY_API_SECRET
  ) {
    throw new AuctionRequestError(503, 'Photo uploads are not configured');
  }
  const fixedFolder = 'campusbid/' + auth.collegeId + '/';
  for (const photo of photos) {
    let parsed: URL;
    try {
      parsed = new URL(photo.url);
    } catch {
      throw new AuctionRequestError(400, 'Photo URL is invalid');
    }
    const uploadPrefix = '/' + cloudName + '/image/upload/';
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'res.cloudinary.com' ||
      !parsed.pathname.startsWith(uploadPrefix) ||
      !photo.publicId.startsWith(fixedFolder)
    ) {
      throw new AuctionRequestError(
        400,
        'Photos must be uploaded to this college’s Cloudinary folder',
      );
    }
    const pathAfterUpload = decodeURIComponent(
      parsed.pathname.slice(uploadPrefix.length),
    ).replace(/^v\d+\//, '');
    if (
      !pathAfterUpload.startsWith(fixedFolder) ||
      (pathAfterUpload !== photo.publicId &&
        !pathAfterUpload.startsWith(photo.publicId + '.'))
    ) {
      throw new AuctionRequestError(
        400,
        'Photo URL and public ID must refer to the same college upload',
      );
    }
  }
}

function encodeCursor(
  sort: CursorSort,
  value: string | number,
  id: string,
): string {
  return Buffer.from(JSON.stringify({ sort, value, id }), 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(
  raw: string | undefined,
  expectedSort: CursorSort,
): { value: Date | number; id: Types.ObjectId } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<CursorPayload> | null;
    if (
      !parsed ||
      parsed.sort !== expectedSort ||
      typeof parsed.id !== 'string' ||
      !/^[\da-f]{24}$/i.test(parsed.id)
    ) {
      throw new InvalidAuctionCursorError();
    }
    if (expectedSort === 'endingSoon' || expectedSort === 'newest') {
      if (typeof parsed.value !== 'string')
        throw new InvalidAuctionCursorError();
      const date = new Date(parsed.value);
      if (Number.isNaN(date.getTime())) throw new InvalidAuctionCursorError();
      return { value: date, id: new Types.ObjectId(parsed.id) };
    }
    if (
      typeof parsed.value !== 'number' ||
      !Number.isSafeInteger(parsed.value) ||
      parsed.value < 0
    ) {
      throw new InvalidAuctionCursorError();
    }
    return { value: parsed.value, id: new Types.ObjectId(parsed.id) };
  } catch (error) {
    if (error instanceof InvalidAuctionCursorError) throw error;
    throw new InvalidAuctionCursorError();
  }
}

function cursorSortField(sort: CursorSort): string {
  if (sort === 'endingSoon') return 'endsAt';
  if (sort === 'newest') return 'listing.createdAt';
  return 'currentPricePaise';
}

function cursorValueFromRow(
  sort: CursorSort,
  row: AuctionListRow,
): string | number {
  if (sort === 'endingSoon') return row.endsAt.toISOString();
  if (sort === 'newest') return row.listing.createdAt.toISOString();
  return row.currentPricePaise;
}

function dateFromInput(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export class AuctionsService {
  private readonly Listing;
  private readonly User;
  private readonly Auction;
  private readonly Bid;

  constructor(
    private readonly connection: Connection,
    private readonly engine: AuctionEngine,
    private readonly config: AppConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.Listing = createListingModel(connection);
    this.User = createUserModel(connection);
    this.Auction = engine.models.Auction;
    this.Bid = engine.models.Bid;
  }

  async create(
    auth: AuthContext,
    input: CreateAuctionInput,
  ): Promise<CreateAuctionResponse> {
    assertRole(auth.roles, 'SELLER');
    const startsAt = dateFromInput(input.startsAt);
    const endsAt = dateFromInput(input.endsAt);
    validateAuctionDates(startsAt, endsAt, this.clock());
    validatePhotos(input.photos, auth, this.config);

    const session = await this.connection.startSession();
    let result: CreateAuctionResponse | undefined;
    try {
      await session.withTransaction(async () => {
        const [listing] = await this.Listing.create(
          [
            {
              collegeId: new Types.ObjectId(auth.collegeId),
              sellerId: new Types.ObjectId(auth.userId),
              title: input.title,
              description: input.description,
              category: input.category,
              condition: input.condition,
              photos: input.photos,
            } satisfies Omit<ListingFields, 'createdAt'>,
          ],
          { session },
        );
        if (!listing)
          throw new Error('Listing creation did not return a document');
        const [auction] = await this.Auction.create(
          [
            {
              collegeId: new Types.ObjectId(auth.collegeId),
              sellerId: new Types.ObjectId(auth.userId),
              listingId: listing._id,
              status: 'scheduled',
              startPricePaise: input.startPricePaise,
              currentPricePaise: input.startPricePaise,
              minIncrementPaise: input.minIncrementPaise,
              ...(input.reservePricePaise === undefined
                ? {}
                : { reservePricePaise: input.reservePricePaise }),
              startsAt,
              endsAt,
              version: 0,
              currentBidId: null,
              winnerBidId: null,
              extensionCount: 0,
            } satisfies AuctionFields,
          ],
          { session },
        );
        if (!auction)
          throw new Error('Auction creation did not return a document');
        result = toCreateAuctionResponse(auction, listing);
      });
    } finally {
      await session.endSession();
    }
    if (!result) throw new Error('Auction transaction returned no result');
    return result;
  }

  async list(auth: AuthContext, query: AuctionListQuery): Promise<AuctionPage> {
    const cursor = decodeCursor(query.cursor, query.sort);
    const statuses = query.status ? [query.status] : [...DEFAULT_LIST_STATUSES];
    const match: QueryFilter<AuctionFields> =
      collegeScopedFilter<AuctionFields>(auth, { status: { $in: statuses } });
    const priceRange: Record<string, number> = {};
    if (query.minPricePaise !== undefined)
      priceRange.$gte = query.minPricePaise;
    if (query.maxPricePaise !== undefined)
      priceRange.$lte = query.maxPricePaise;
    if (Object.keys(priceRange).length > 0)
      match.currentPricePaise = priceRange;

    if (query.q) {
      const listingFilter: QueryFilter<ListingFields> =
        collegeScopedFilter<ListingFields>(auth, {
          $text: { $search: query.q },
        });
      if (query.category) listingFilter.category = query.category;
      const matches = await this.Listing.find(listingFilter)
        .select({ _id: 1 })
        .lean()
        .exec();
      if (matches.length === 0) {
        return { items: [], pageInfo: { nextCursor: null, hasMore: false } };
      }
      match.listingId = { $in: matches.map((listing) => listing._id) };
    }

    const field = cursorSortField(query.sort);
    const direction =
      query.sort === 'newest' || query.sort === 'priceHigh' ? -1 : 1;
    const pipeline: PipelineStage[] = [
      { $match: match as PipelineStage.Match['$match'] },
      {
        $lookup: {
          from: this.Listing.collection.name,
          let: { listingId: '$listingId', auctionCollegeId: '$collegeId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$_id', '$$listingId'] },
                    { $eq: ['$collegeId', '$$auctionCollegeId'] },
                  ],
                },
              },
            },
          ],
          as: 'listing',
        },
      },
      { $unwind: '$listing' },
    ];
    if (query.category)
      pipeline.push({ $match: { 'listing.category': query.category } });
    if (cursor) {
      const cursorValue = cursor.value;
      const comparison = direction === 1 ? '$gt' : '$lt';
      pipeline.push({
        $match: {
          $or: [
            { [field]: { [comparison]: cursorValue } },
            { [field]: cursorValue, _id: { [comparison]: cursor.id } },
          ],
        },
      });
    }
    pipeline.push(
      { $sort: { [field]: direction, _id: direction } },
      { $limit: query.limit + 1 },
    );

    const rows = await this.Auction.aggregate<AuctionListRow>(pipeline).exec();
    const hasMore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit);
    const items = pageRows.map((row) => toAuctionListItem(row, row.listing));
    const last = pageRows.at(-1);
    const nextCursor =
      hasMore && last
        ? encodeCursor(
            query.sort,
            cursorValueFromRow(query.sort, last),
            last._id.toString(),
          )
        : null;
    return { items, pageInfo: { nextCursor, hasMore } };
  }

  async detail(auth: AuthContext, auctionId: string): Promise<AuctionDetail> {
    const auction = await this.Auction.findOne(
      collegeScopedFilter<AuctionFields>(auth, {
        _id: new Types.ObjectId(auctionId),
      }),
    )
      .lean()
      .exec();
    if (!auction) throw new ScopedResourceNotFoundError();

    const [listing, seller, bidders, latestBids] = await Promise.all([
      this.Listing.findOne(
        collegeScopedFilter<ListingFields>(auth, { _id: auction.listingId }),
      )
        .lean()
        .exec(),
      this.User.findOne(
        collegeScopedFilter<UserFields>(auth, { _id: auction.sellerId }),
      )
        .select({ name: 1 })
        .lean()
        .exec(),
      this.Bid.aggregate<FirstBidderRow>([
        { $match: { auctionId: auction._id, collegeId: auction.collegeId } },
        { $sort: { createdAt: 1, _id: 1 } },
        { $group: { _id: '$bidderId', firstBidAt: { $first: '$createdAt' } } },
        { $sort: { firstBidAt: 1, _id: 1 } },
      ]).exec(),
      this.Bid.find({ auctionId: auction._id, collegeId: auction.collegeId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(20)
        .lean()
        .exec(),
    ]);
    if (!listing || !seller) throw new ScopedResourceNotFoundError();

    const bidderLabels = new Map<string, string>();
    bidders.forEach((bidder, index) => {
      bidderLabels.set(bidder._id.toString(), 'Bidder ' + String(index + 1));
    });
    const bids = latestBids.reverse().map((bid) => ({
      amountPaise: bid.amountPaise,
      createdAt: bid.createdAt.toISOString(),
      bidderLabel:
        bid.bidderId.toString() === auth.userId
          ? 'You'
          : (bidderLabels.get(bid.bidderId.toString()) ?? 'Bidder'),
    }));

    return {
      id: auction._id.toString(),
      status: auction.status,
      startPricePaise: auction.startPricePaise,
      currentPricePaise: auction.currentPricePaise,
      minIncrementPaise: auction.minIncrementPaise,
      ...(auction.reservePricePaise === undefined
        ? {}
        : { reservePricePaise: auction.reservePricePaise }),
      startsAt: auction.startsAt.toISOString(),
      endsAt: auction.endsAt.toISOString(),
      version: auction.version,
      serverTime: this.clock().toISOString(),
      sellerName: seller.name,
      listing: toPublicListing(listing),
      bids,
    };
  }

  async ownAuctions(auth: AuthContext): Promise<MyAuction[]> {
    const auctions = await this.Auction.find(
      collegeScopedFilter<AuctionFields>(auth, {
        sellerId: new Types.ObjectId(auth.userId),
      }),
    )
      .sort({ startsAt: 1, _id: 1 })
      .lean()
      .exec();
    const listings = await this.Listing.find(
      collegeScopedFilter<ListingFields>(auth, {
        _id: { $in: auctions.map((auction) => auction.listingId) },
        sellerId: new Types.ObjectId(auth.userId),
      }),
    )
      .lean()
      .exec();
    const byId = new Map(
      listings.map((listing) => [listing._id.toString(), listing]),
    );
    return auctions.flatMap((auction) => {
      const listing = byId.get(auction.listingId.toString());
      return listing ? [toAuctionListItem(auction, listing)] : [];
    });
  }

  async ownBids(auth: AuthContext): Promise<MyBid[]> {
    const bids = await this.Bid.find(
      collegeScopedFilter<BidFields>(auth, {
        bidderId: new Types.ObjectId(auth.userId),
      }),
    )
      .sort({ createdAt: -1, _id: -1 })
      .lean()
      .exec();
    const auctions = await this.Auction.find(
      collegeScopedFilter<AuctionFields>(auth, {
        _id: { $in: bids.map((bid) => bid.auctionId) },
      }),
    )
      .lean()
      .exec();
    const auctionById = new Map(
      auctions.map((auction) => [auction._id.toString(), auction]),
    );
    const listings = await this.Listing.find(
      collegeScopedFilter<ListingFields>(auth, {
        _id: { $in: auctions.map((auction) => auction.listingId) },
      }),
    )
      .lean()
      .exec();
    const listingById = new Map(
      listings.map((listing) => [listing._id.toString(), listing]),
    );
    return bids.flatMap((bid) => {
      const auction = auctionById.get(bid.auctionId.toString());
      const listing = auction
        ? listingById.get(auction.listingId.toString())
        : undefined;
      if (!auction || !listing) return [];
      return [
        {
          amountPaise: bid.amountPaise,
          createdAt: bid.createdAt.toISOString(),
          auction: {
            id: auction._id.toString(),
            status: auction.status,
            currentPricePaise: auction.currentPricePaise,
            endsAt: auction.endsAt.toISOString(),
            listing: toPublicListing(listing),
          },
        },
      ];
    });
  }

  async patch(
    auth: AuthContext,
    auctionId: string,
    input: PatchAuctionInput,
  ): Promise<CreateAuctionResponse> {
    assertRole(auth.roles, 'SELLER');
    const id = new Types.ObjectId(auctionId);
    const current = await this.Auction.findOne(
      collegeScopedFilter<AuctionFields>(auth, { _id: id }),
    )
      .lean()
      .exec();
    if (!current) throw new ScopedResourceNotFoundError();
    if (current.sellerId.toString() !== auth.userId) {
      throw new ScopedResourceNotFoundError();
    }
    const now = this.clock();
    if (
      current.currentBidId ||
      current.startsAt.getTime() <= now.getTime() ||
      (current.status !== 'draft' && current.status !== 'scheduled')
    ) {
      throw new AuctionRequestError(409, 'Auction can no longer be edited');
    }

    const startsAt = input.startsAt
      ? dateFromInput(input.startsAt)
      : current.startsAt;
    const endsAt = input.endsAt ? dateFromInput(input.endsAt) : current.endsAt;
    validateAuctionDates(startsAt, endsAt, now);
    const photos = input.photos ?? [];
    validatePhotos(photos, auth, this.config);

    const listingFields: Partial<ListingFields> = {};
    if (input.title !== undefined) listingFields.title = input.title;
    if (input.description !== undefined)
      listingFields.description = input.description;
    if (input.category !== undefined) listingFields.category = input.category;
    if (input.condition !== undefined)
      listingFields.condition = input.condition;
    if (input.photos !== undefined)
      listingFields.photos = input.photos as StoredListingPhoto[];

    const startPricePaise = input.startPricePaise ?? current.startPricePaise;
    const auctionFields: Partial<AuctionFields> = {
      startPricePaise,
      currentPricePaise: startPricePaise,
      startsAt,
      endsAt,
    };
    if (input.minIncrementPaise !== undefined) {
      auctionFields.minIncrementPaise = input.minIncrementPaise;
    }
    if (input.reservePricePaise !== undefined) {
      auctionFields.reservePricePaise = input.reservePricePaise;
    }

    const session = await this.connection.startSession();
    let result: CreateAuctionResponse | undefined;
    try {
      await session.withTransaction(async () => {
        const updatedAuction = await this.Auction.findOneAndUpdate(
          collegeScopedFilter<AuctionFields>(auth, {
            _id: id,
            sellerId: new Types.ObjectId(auth.userId),
            status: { $in: ['draft', 'scheduled'] },
            startsAt: { $gt: now },
            currentBidId: null,
          }),
          { $set: auctionFields, $inc: { version: 1 } },
          { session, returnDocument: 'after', runValidators: true },
        )
          .lean()
          .exec();
        if (!updatedAuction) {
          throw new AuctionRequestError(409, 'Auction can no longer be edited');
        }
        const updatedListing = await this.Listing.findOneAndUpdate(
          collegeScopedFilter<ListingFields>(auth, {
            _id: current.listingId,
            sellerId: new Types.ObjectId(auth.userId),
          }),
          { $set: listingFields },
          { session, returnDocument: 'after', runValidators: true },
        )
          .lean()
          .exec();
        if (!updatedListing) throw new ScopedResourceNotFoundError();
        result = toCreateAuctionResponse(updatedAuction, updatedListing);
      });
    } finally {
      await session.endSession();
    }
    if (!result)
      throw new Error('Auction update transaction returned no result');
    return result;
  }

  async cancel(auth: AuthContext, auctionId: string): Promise<AuctionSnapshot> {
    if (!auth.roles.includes('ADMIN') && !auth.roles.includes('SELLER')) {
      throw new AuthorizationError();
    }
    const auction = await this.Auction.findOne(
      collegeScopedFilter<AuctionFields>(auth, {
        _id: new Types.ObjectId(auctionId),
      }),
    )
      .lean()
      .exec();
    if (!auction) throw new ScopedResourceNotFoundError();
    assertOwner(auction.sellerId.toString(), auth);
    const result = await this.engine.cancelAuction({
      auctionId,
      collegeId: auth.collegeId,
    });
    if (!result.ok) {
      if (result.code === 'NOT_FOUND') throw new ScopedResourceNotFoundError();
      throw new AuctionRequestError(409, 'Auction cannot be cancelled');
    }
    return result.auction;
  }
}
