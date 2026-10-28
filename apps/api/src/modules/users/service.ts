import { Types, type Connection, type Model } from 'mongoose';
import type { AuthContext, UserRole, UserStatus } from '@campusbid/shared';
import {
  collegeScopedFilter,
  ScopedResourceNotFoundError,
} from '../colleges/scope.js';
import { createAuthModels, type RefreshTokenFields } from '../auth/models.js';
import type { UserRepository } from './repository.js';
import type { UserFields } from './model.js';
import { assertRole } from '../../middleware/require-role.js';

export interface SafeUser {
  id: string;
  email: string;
  collegeId: string;
  roles: UserRole[];
  status: UserStatus;
  emailVerifiedAt: Date | null;
  name: string;
  createdAt: Date;
}

function toSafeUser(user: UserFields & { _id: Types.ObjectId }): SafeUser {
  return {
    id: user._id.toString(),
    email: user.email,
    collegeId: user.collegeId.toString(),
    roles: [...user.roles],
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    name: user.name,
    createdAt: user.createdAt,
  };
}

export class UserService {
  private readonly RefreshToken: Model<RefreshTokenFields>;

  constructor(
    private readonly connection: Connection,
    private readonly users: UserRepository,
    refreshTokens?: Model<RefreshTokenFields>,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.RefreshToken =
      refreshTokens ?? createAuthModels(connection).RefreshToken;
  }

  async me(auth: AuthContext): Promise<SafeUser> {
    const user = await this.users.findForAuth(auth);
    if (!user || user.status !== 'active' || !user.emailVerifiedAt) {
      throw new ScopedResourceNotFoundError();
    }
    return toSafeUser(user);
  }

  async listForAdmin(
    auth: AuthContext,
    page: number,
    pageSize: number,
  ): Promise<{
    users: SafeUser[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    await this.assertCurrentAdmin(auth);
    const skip = (page - 1) * pageSize;
    const [users, total] = await Promise.all([
      this.users.listForAdmin(auth, skip, pageSize),
      this.users.countForAdmin(auth),
    ]);
    return {
      users: users.map((user) =>
        toSafeUser(user as UserFields & { _id: Types.ObjectId }),
      ),
      page,
      pageSize,
      total,
    };
  }

  async setStatusForAdmin(
    auth: AuthContext,
    userId: string,
    status: UserStatus,
  ): Promise<SafeUser> {
    assertRole(auth.roles, 'ADMIN');
    const session = await this.connection.startSession();
    let updated: (UserFields & { _id: Types.ObjectId }) | null = null;
    try {
      await session.withTransaction(async () => {
        updated = null;
        const actor = await this.users.model
          .findOne(
            collegeScopedFilter<UserFields>(auth, {
              _id: new Types.ObjectId(auth.userId),
              status: 'active',
              emailVerifiedAt: { $ne: null },
              roles: 'ADMIN',
            }),
          )
          .session(session)
          .exec();
        if (!actor) throw new ScopedResourceNotFoundError();

        updated = (await this.users.model
          .findOneAndUpdate(
            collegeScopedFilter<UserFields>(auth, {
              _id: new Types.ObjectId(userId),
            }),
            { $set: { status } },
            { returnDocument: 'after', runValidators: true, session },
          )
          .exec()) as (UserFields & { _id: Types.ObjectId }) | null;
        if (!updated) return;

        if (status === 'banned') {
          await this.RefreshToken.updateMany(
            collegeScopedFilter<RefreshTokenFields>(auth, {
              userId: new Types.ObjectId(userId),
              revokedAt: null,
            }),
            { $set: { revokedAt: this.clock() } },
            { session },
          ).exec();
        }
      });
    } finally {
      await session.endSession();
    }
    if (!updated) throw new ScopedResourceNotFoundError();
    return toSafeUser(updated);
  }

  private async assertCurrentAdmin(auth: AuthContext): Promise<void> {
    assertRole(auth.roles, 'ADMIN');
    const actor = await this.users.model
      .findOne(
        collegeScopedFilter<UserFields>(auth, {
          _id: new Types.ObjectId(auth.userId),
          status: 'active',
          emailVerifiedAt: { $ne: null },
          roles: 'ADMIN',
        }),
      )
      .exec();
    if (!actor) throw new ScopedResourceNotFoundError();
  }
}
