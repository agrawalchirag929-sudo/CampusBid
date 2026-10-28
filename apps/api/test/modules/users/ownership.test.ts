import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@campusbid/shared';
import {
  collegeScopedFilter,
  assertSameCollege,
  ScopedResourceNotFoundError,
} from '../../../src/modules/colleges/scope.js';
import {
  assertOwner,
  assertOwnedAuction,
} from '../../../src/modules/users/ownership.js';

const collegeA = new Types.ObjectId();
const collegeB = new Types.ObjectId();
const ownerId = new Types.ObjectId().toString();
const otherId = new Types.ObjectId().toString();
const buyer: AuthContext = {
  userId: otherId,
  collegeId: collegeA.toString(),
  roles: ['BUYER'],
};
const owner: AuthContext = {
  userId: ownerId,
  collegeId: collegeA.toString(),
  roles: ['SELLER'],
};
const admin: AuthContext = {
  userId: otherId,
  collegeId: collegeA.toString(),
  roles: ['ADMIN'],
};

describe('college and ownership guards', () => {
  it('overwrites any caller-supplied collegeId with the authenticated database context', () => {
    const filter = collegeScopedFilter<{
      collegeId: Types.ObjectId;
      email: string;
    }>(buyer, { collegeId: collegeB, email: 'student@example.edu' });
    expect(filter.collegeId?.toString()).toBe(collegeA.toString());
    expect(filter.email).toBe('student@example.edu');
  });

  it('hides cross-college resources as not found', () => {
    expect(() => assertSameCollege(collegeB, buyer)).toThrow(
      ScopedResourceNotFoundError,
    );
    expect(() =>
      assertOwnedAuction(
        { sellerId: new Types.ObjectId(ownerId), collegeId: collegeB },
        admin,
      ),
    ).toThrow(ScopedResourceNotFoundError);
  });

  it('allows a seller owner and allows an admin override within that college', () => {
    expect(() => assertOwner(ownerId, owner)).not.toThrow();
    expect(() => assertOwner(ownerId, admin)).not.toThrow();
    expect(() => assertOwner(ownerId, buyer)).toThrow(
      ScopedResourceNotFoundError,
    );
  });
});
