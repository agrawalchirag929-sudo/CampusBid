import { z } from 'zod';
import { AUCTION_STATUSES } from '@campusbid/auction-engine';
import { LISTING_CATEGORIES, LISTING_CONDITIONS } from '../listings/model.js';

export const listingPhotoInputSchema = z
  .object({
    url: z.string().url().max(2_048),
    publicId: z.string().trim().min(1).max(255),
  })
  .strict();

const listingInputs = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(5).max(5_000),
  category: z.enum(LISTING_CATEGORIES),
  condition: z.enum(LISTING_CONDITIONS),
  photos: z.array(listingPhotoInputSchema).max(6),
};

const auctionInputs = {
  startPricePaise: z.number().int().safe().nonnegative(),
  minIncrementPaise: z.number().int().safe().min(1),
  reservePricePaise: z.number().int().safe().nonnegative().optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
};

export const createAuctionSchema = z
  .object({ ...listingInputs, ...auctionInputs })
  .strict();
export type CreateAuctionInput = z.infer<typeof createAuctionSchema>;

export const patchAuctionSchema = z
  .object({ ...listingInputs, ...auctionInputs })
  .partial()
  .strict()
  .refine(
    (input) => Object.keys(input).length > 0,
    'At least one field is required',
  );
export type PatchAuctionInput = z.infer<typeof patchAuctionSchema>;

export const auctionListQuerySchema = z
  .object({
    category: z.enum(LISTING_CATEGORIES).optional(),
    status: z.enum(AUCTION_STATUSES).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    minPricePaise: z.coerce.number().int().safe().nonnegative().optional(),
    maxPricePaise: z.coerce.number().int().safe().nonnegative().optional(),
    sort: z
      .enum(['endingSoon', 'newest', 'priceLow', 'priceHigh'])
      .default('endingSoon'),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine(
    (query) =>
      query.minPricePaise === undefined ||
      query.maxPricePaise === undefined ||
      query.minPricePaise <= query.maxPricePaise,
    'Minimum price must not exceed maximum price',
  );
export type AuctionListQuery = z.infer<typeof auctionListQuerySchema>;

export const objectIdParamsSchema = z
  .object({ id: z.string().regex(/^[\da-f]{24}$/i) })
  .strict();
