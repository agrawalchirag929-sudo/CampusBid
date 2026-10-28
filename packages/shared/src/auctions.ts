import { z } from 'zod';

export const LISTING_CATEGORIES = [
  'textbooks',
  'electronics',
  'lab-equipment',
  'calculators',
  'cycles',
  'other',
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_CONDITIONS = [
  'new',
  'like-new',
  'good',
  'fair',
  'poor',
] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

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

export const listingPhotoSchema = z
  .object({ url: z.string().url(), publicId: z.string() })
  .strict();
export type ListingPhoto = z.infer<typeof listingPhotoSchema>;

export const publicListingSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    category: z.enum(LISTING_CATEGORIES),
    condition: z.enum(LISTING_CONDITIONS),
    photos: z.array(listingPhotoSchema).max(6),
    createdAt: z.string().datetime(),
  })
  .strict();
export type PublicListing = z.infer<typeof publicListingSchema>;

export const auctionListItemSchema = z
  .object({
    id: z.string(),
    status: z.enum(AUCTION_STATUSES),
    startPricePaise: z.number().int().nonnegative(),
    currentPricePaise: z.number().int().nonnegative(),
    minIncrementPaise: z.number().int().positive(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    version: z.number().int().nonnegative(),
    listing: publicListingSchema,
  })
  .strict();
export type AuctionListItem = z.infer<typeof auctionListItemSchema>;

export const auctionPageSchema = z
  .object({
    items: z.array(auctionListItemSchema),
    pageInfo: z
      .object({ nextCursor: z.string().nullable(), hasMore: z.boolean() })
      .strict(),
  })
  .strict();
export type AuctionPage = z.infer<typeof auctionPageSchema>;

export const auctionDetailSchema = z
  .object({
    id: z.string(),
    status: z.enum(AUCTION_STATUSES),
    startPricePaise: z.number().int().nonnegative(),
    currentPricePaise: z.number().int().nonnegative(),
    minIncrementPaise: z.number().int().positive(),
    reservePricePaise: z.number().int().nonnegative().optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    version: z.number().int().nonnegative(),
    serverTime: z.string().datetime(),
    sellerName: z.string(),
    listing: publicListingSchema,
    bids: z
      .array(
        z
          .object({
            amountPaise: z.number().int().nonnegative(),
            createdAt: z.string().datetime(),
            bidderLabel: z.string(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type AuctionDetail = z.infer<typeof auctionDetailSchema>;

export const myAuctionSchema = auctionListItemSchema;
export type MyAuction = z.infer<typeof myAuctionSchema>;

export const myBidSchema = z
  .object({
    amountPaise: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    auction: z
      .object({
        id: z.string(),
        status: z.enum(AUCTION_STATUSES),
        currentPricePaise: z.number().int().nonnegative(),
        endsAt: z.string().datetime(),
        listing: publicListingSchema,
      })
      .strict(),
  })
  .strict();
export type MyBid = z.infer<typeof myBidSchema>;

export const signedUploadParamsSchema = z
  .object({
    cloudName: z.string(),
    apiKey: z.string(),
    timestamp: z.number().int(),
    folder: z.string(),
    allowedFormats: z.string(),
    maxFileSize: z.number().int().positive(),
    signature: z.string(),
  })
  .strict();
export type SignedUploadParams = z.infer<typeof signedUploadParamsSchema>;

export const createAuctionResponseSchema = z
  .object({
    id: z.string(),
    status: z.enum(AUCTION_STATUSES),
    listing: publicListingSchema,
    startPricePaise: z.number().int().nonnegative(),
    currentPricePaise: z.number().int().nonnegative(),
    minIncrementPaise: z.number().int().positive(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type CreateAuctionResponse = z.infer<typeof createAuctionResponseSchema>;

export const cancelAuctionResponseSchema = z
  .object({
    id: z.string(),
    status: z.literal('cancelled'),
    version: z.number().int().nonnegative(),
  })
  .strict();
export type CancelAuctionResponse = z.infer<typeof cancelAuctionResponseSchema>;

export const apiErrorResponseSchema = z.object({ error: z.string() }).strict();
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
