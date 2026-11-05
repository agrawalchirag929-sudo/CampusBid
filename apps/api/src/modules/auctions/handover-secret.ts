import { Schema, type Connection, type Model, type Types } from 'mongoose';

export interface HandoverSecretFields {
  auctionId: Types.ObjectId;
  collegeId: Types.ObjectId;
  winnerBidId: Types.ObjectId;
  winnerId: Types.ObjectId;
  encryptedCode: string | null;
  consumedAt: Date | null;
  createdAt: Date;
}

export const handoverSecretSchema = new Schema<HandoverSecretFields>(
  {
    auctionId: { type: Schema.Types.ObjectId, required: true, ref: 'Auction' },
    collegeId: { type: Schema.Types.ObjectId, required: true, ref: 'College' },
    winnerBidId: { type: Schema.Types.ObjectId, required: true, ref: 'Bid' },
    winnerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    encryptedCode: { type: String, default: null, select: false },
    consumedAt: { type: Date, default: null },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  { collection: 'handoverSecrets', versionKey: false },
);

handoverSecretSchema.index(
  { auctionId: 1 },
  { unique: true, name: 'handover_secret_auction_unique' },
);
handoverSecretSchema.index(
  { collegeId: 1, winnerId: 1, consumedAt: 1 },
  { name: 'handover_secret_winner_college' },
);

export function createHandoverSecretModel(
  connection: Connection,
): Model<HandoverSecretFields> {
  return (
    (connection.models.HandoverSecret as
      Model<HandoverSecretFields> | undefined) ??
    connection.model<HandoverSecretFields>(
      'HandoverSecret',
      handoverSecretSchema,
    )
  );
}
