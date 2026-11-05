import { z } from 'zod';

export const verificationEmailPayloadSchema = z
  .object({
    kind: z.literal('verification-email'),
    to: z.string().email().max(320),
    name: z.string().min(1).max(100),
    token: z.string().min(32).max(256),
  })
  .strict();

export const auctionNotificationEmailPayloadSchema = z.discriminatedUnion(
  'kind',
  [
    z
      .object({
        kind: z.literal('auction-outbid'),
        to: z.string().email().max(320),
        name: z.string().min(1).max(100),
        auctionTitle: z.string().min(1).max(120),
        amountPaise: z.number().int().safe().nonnegative(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('auction-won'),
        to: z.string().email().max(320),
        name: z.string().min(1).max(100),
        auctionTitle: z.string().min(1).max(120),
        amountPaise: z.number().int().safe().nonnegative(),
        handoverCode: z.string().length(6).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('auction-sold'),
        to: z.string().email().max(320),
        name: z.string().min(1).max(100),
        auctionTitle: z.string().min(1).max(120),
        amountPaise: z.number().int().safe().nonnegative(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('auction-unsold'),
        to: z.string().email().max(320),
        name: z.string().min(1).max(100),
        auctionTitle: z.string().min(1).max(120),
      })
      .strict(),
  ],
);

export const queuedEmailPayloadSchema = z.discriminatedUnion('kind', [
  verificationEmailPayloadSchema,
  ...auctionNotificationEmailPayloadSchema.options,
]);

export type VerificationEmailPayload = z.infer<
  typeof verificationEmailPayloadSchema
>;
export type AuctionNotificationEmailPayload = z.infer<
  typeof auctionNotificationEmailPayloadSchema
>;
export type QueuedEmailPayload = z.infer<typeof queuedEmailPayloadSchema>;
