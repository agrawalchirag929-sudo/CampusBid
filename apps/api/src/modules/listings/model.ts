import { Schema, type Connection, type Model, type Types } from 'mongoose';
import { LISTING_CATEGORIES, LISTING_CONDITIONS } from '@campusbid/shared';
import type {
  ListingCategory,
  ListingCondition,
  ListingPhoto,
} from '@campusbid/shared';

export { LISTING_CATEGORIES, LISTING_CONDITIONS } from '@campusbid/shared';
export type {
  ListingCategory,
  ListingCondition,
  ListingPhoto,
} from '@campusbid/shared';

export interface ListingFields {
  collegeId: Types.ObjectId;
  sellerId: Types.ObjectId;
  title: string;
  description: string;
  category: ListingCategory;
  condition: ListingCondition;
  photos: ListingPhoto[];
  createdAt: Date;
}

const photoSchema = new Schema<ListingPhoto>(
  {
    url: { type: String, required: true, maxlength: 2_048 },
    publicId: { type: String, required: true, trim: true, maxlength: 255 },
  },
  { _id: false, versionKey: false },
);

export const listingSchema = new Schema<ListingFields>(
  {
    collegeId: { type: Schema.Types.ObjectId, required: true, ref: 'College' },
    sellerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 120,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 5_000,
    },
    category: { type: String, required: true, enum: LISTING_CATEGORIES },
    condition: { type: String, required: true, enum: LISTING_CONDITIONS },
    photos: {
      type: [photoSchema],
      required: true,
      default: [],
      validate: {
        validator: (photos: ListingPhoto[]) => photos.length <= 6,
        message: 'A listing may contain at most six photos',
      },
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  { collection: 'listings', versionKey: false },
);

listingSchema.index(
  { collegeId: 1, title: 'text', description: 'text' },
  { name: 'listing_college_text' },
);
listingSchema.index(
  { collegeId: 1, category: 1, createdAt: -1 },
  { name: 'listing_college_category_createdAt' },
);
listingSchema.index(
  { collegeId: 1, sellerId: 1, createdAt: -1 },
  { name: 'listing_college_seller_createdAt' },
);

export function createListingModel(
  connection: Connection,
): Model<ListingFields> {
  return (
    (connection.models.Listing as Model<ListingFields> | undefined) ??
    connection.model<ListingFields>('Listing', listingSchema)
  );
}
