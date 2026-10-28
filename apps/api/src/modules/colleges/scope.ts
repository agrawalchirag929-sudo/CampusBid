import { Types } from 'mongoose';
import type { QueryFilter } from 'mongoose';
import type { AuthContext } from '@campusbid/shared';

export class ScopedResourceNotFoundError extends Error {
  constructor() {
    super('Resource not found');
    this.name = 'ScopedResourceNotFoundError';
  }
}

type FilterFor<T> = QueryFilter<T>;

export function collegeScopedFilter<T extends { collegeId: Types.ObjectId }>(
  auth: Pick<AuthContext, 'collegeId'>,
  filter: FilterFor<T> = {} as FilterFor<T>,
): FilterFor<T> {
  return {
    ...filter,
    collegeId: new Types.ObjectId(auth.collegeId),
  } as FilterFor<T>;
}

export function assertSameCollege(
  resourceCollegeId: Types.ObjectId | string,
  auth: Pick<AuthContext, 'collegeId'>,
): void {
  if (resourceCollegeId.toString() !== auth.collegeId) {
    throw new ScopedResourceNotFoundError();
  }
}
