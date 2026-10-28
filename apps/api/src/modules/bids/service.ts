import type {
  AuctionEngine,
  PlaceBidInput,
  PlaceBidResult,
} from '@campusbid/auction-engine';
import type { AuthContext } from '@campusbid/shared';
import { AuthorizationError } from '../../middleware/require-role.js';

export class BidsService {
  constructor(private readonly engine: AuctionEngine) {}

  placeBid(
    auth: AuthContext,
    input: Pick<PlaceBidInput, 'auctionId' | 'amountPaise' | 'idemKey'>,
  ): Promise<PlaceBidResult> {
    if (!auth.roles.includes('BUYER')) throw new AuthorizationError();
    return this.engine.placeBid({
      auctionId: input.auctionId,
      amountPaise: input.amountPaise,
      idemKey: input.idemKey,
      bidderId: auth.userId,
      collegeId: auth.collegeId,
    });
  }
}
