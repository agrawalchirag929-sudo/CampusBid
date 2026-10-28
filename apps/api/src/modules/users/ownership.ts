import type { Types } from 'mongoose';
import {
  assertSameCollege,
  ScopedResourceNotFoundError,
} from '../colleges/scope.js';
import type { AuthContext } from '@campusbid/shared';

export function assertOwner(resourceSellerId: string, auth: AuthContext): void {
  if (!auth.roles.includes('ADMIN') && resourceSellerId !== auth.userId) {
    throw new ScopedResourceNotFoundError();
  }
}

export function assertOwnedAuction(
  resource: { sellerId: Types.ObjectId; collegeId: Types.ObjectId },
  auth: AuthContext,
): void {
  assertSameCollege(resource.collegeId, auth);
  assertOwner(resource.sellerId.toString(), auth);
}
