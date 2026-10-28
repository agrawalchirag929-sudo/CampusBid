import { Types, type Connection, type Model } from 'mongoose';
import type { AuthContext, UserRole, UserStatus } from '@campusbid/shared';
import { collegeScopedFilter } from '../colleges/scope.js';
import { createUserModel, type UserFields } from './model.js';

export class UserRepository {
  readonly model: Model<UserFields>;

  constructor(connection: Connection) {
    this.model = createUserModel(connection);
  }

  // Public authentication bootstrap lookup; no authenticated college exists yet.
  findForSignupByEmail(email: string) {
    return this.model.findOne({ email }).exec();
  }

  // Public authentication bootstrap lookup; email is globally unique.
  findForLoginByEmail(email: string) {
    return this.model.findOne({ email }).select('+passwordHash').exec();
  }

  // Public email-verification lookup, called only with a token's stored user and college IDs.
  findForVerification(userId: Types.ObjectId, collegeId: Types.ObjectId) {
    return this.model.findOne({ _id: userId, collegeId }).exec();
  }

  findAuthenticatedUser(userId: string, collegeId: string) {
    return this.model
      .findOne({
        _id: new Types.ObjectId(userId),
        collegeId: new Types.ObjectId(collegeId),
        status: 'active',
        emailVerifiedAt: { $ne: null },
      })
      .exec();
  }

  findForAuth(auth: AuthContext) {
    return this.model
      .findOne(
        collegeScopedFilter<UserFields>(auth, {
          _id: new Types.ObjectId(auth.userId),
        }),
      )
      .exec();
  }

  listForAdmin(auth: AuthContext, skip: number, limit: number) {
    return this.model
      .find(collegeScopedFilter<UserFields>(auth))
      .select('_id email collegeId roles status emailVerifiedAt name createdAt')
      .sort({ createdAt: -1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
  }

  countForAdmin(auth: AuthContext) {
    return this.model
      .countDocuments(collegeScopedFilter<UserFields>(auth))
      .exec();
  }

  findAdminTarget(auth: AuthContext, userId: string) {
    return this.model
      .findOne(
        collegeScopedFilter<UserFields>(auth, {
          _id: new Types.ObjectId(userId),
        }),
      )
      .exec();
  }

  setStatusInCollege(auth: AuthContext, userId: string, status: UserStatus) {
    return this.model
      .findOneAndUpdate(
        collegeScopedFilter<UserFields>(auth, {
          _id: new Types.ObjectId(userId),
        }),
        { $set: { status } },
        { returnDocument: 'after', runValidators: true },
      )
      .exec();
  }

  grantAdminByEmail(email: string) {
    return this.model
      .findOneAndUpdate(
        { email, status: 'active', emailVerifiedAt: { $ne: null } },
        { $addToSet: { roles: 'ADMIN' satisfies UserRole } },
        { returnDocument: 'after', runValidators: true },
      )
      .exec();
  }
}
