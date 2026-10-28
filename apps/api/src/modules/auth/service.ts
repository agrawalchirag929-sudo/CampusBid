import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Connection, Model } from 'mongoose';
import type { Types } from 'mongoose';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { SignJWT } from 'jose';
import type { AppConfig } from '../../config.js';
import type { SignupInput, UserRole } from '@campusbid/shared';
import { CollegeService } from '../colleges/service.js';
import { createUserModel, type UserFields } from '../users/model.js';
import { UserRepository } from '../users/repository.js';
import { AuthServiceError } from './errors.js';
import {
  createAuthModels,
  type AuthModels,
  type RefreshTokenFields,
  type VerificationTokenFields,
} from './models.js';
import { MailOutboxRepository } from '../notifications/repository.js';

const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;
const REFRESH_REUSE_GRACE_MS = 10_000;
const PUBLIC_SIGNUP_MESSAGE =
  'If the address is eligible, we will send verification instructions.';
const DUMMY_PASSWORD_HASH = hash(
  randomBytes(32).toString('base64url'),
  ARGON_OPTIONS,
);

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthServiceOptions {
  connection: Connection;
  config: AppConfig;
  users?: UserRepository;
  authModels?: AuthModels;
  clock?: () => Date;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

async function minimumElapsed(
  startedAt: number,
  minimumMs: number,
): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0)
    await new Promise<void>((resolve) => setTimeout(resolve, remaining));
}

export class AuthService {
  private readonly User: Model<UserFields>;
  private readonly colleges: CollegeService;
  private readonly VerificationToken: Model<VerificationTokenFields>;
  private readonly RefreshToken: Model<RefreshTokenFields>;
  private readonly users: UserRepository;
  private readonly mailOutbox: MailOutboxRepository;
  private readonly clock: () => Date;
  private readonly key: Uint8Array;

  constructor(private readonly options: AuthServiceOptions) {
    this.colleges = new CollegeService(options.connection);
    this.User = createUserModel(options.connection);
    this.users = options.users ?? new UserRepository(options.connection);
    const authModels =
      options.authModels ?? createAuthModels(options.connection);
    this.VerificationToken = authModels.VerificationToken;
    this.RefreshToken = authModels.RefreshToken;
    this.mailOutbox = new MailOutboxRepository(
      options.connection,
      options.config.JWT_SECRET,
    );
    this.clock = options.clock ?? (() => new Date());
    this.key = new TextEncoder().encode(options.config.JWT_SECRET);
  }

  async signup(input: SignupInput): Promise<{ message: string }> {
    const startedAt = Date.now();
    const email = normalizeEmail(input.email);
    const college = await this.colleges.findActiveForEmail(email);
    if (!college) throw new AuthServiceError('EMAIL_DOMAIN_UNSUPPORTED');

    const passwordHash = await hash(input.password, ARGON_OPTIONS);
    const existing = await this.users.findForSignupByEmail(email);
    if (existing) {
      await minimumElapsed(startedAt, 300);
      return { message: PUBLIC_SIGNUP_MESSAGE };
    }

    const rawToken = randomBytes(32).toString('base64url');
    const session = await this.options.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const user = new this.User({
          email,
          passwordHash,
          collegeId: college._id,
          roles: [],
          status: 'active',
          emailVerifiedAt: null,
          name: input.name,
        });
        await user.save({ session });
        await new this.VerificationToken({
          tokenHash: sha256(rawToken),
          userId: user._id,
          collegeId: college._id,
          expiresAt: new Date(
            this.clock().getTime() + VERIFICATION_TOKEN_TTL_MS,
          ),
          consumedAt: null,
        }).save({ session });
        await this.mailOutbox.enqueueVerificationEmail(
          { to: email, name: input.name, token: rawToken },
          { userId: user._id, collegeId: college._id },
          session,
        );
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      await minimumElapsed(startedAt, 300);
      return { message: PUBLIC_SIGNUP_MESSAGE };
    } finally {
      await session.endSession();
    }

    await minimumElapsed(startedAt, 300);
    return { message: PUBLIC_SIGNUP_MESSAGE };
  }

  async resendVerification(emailInput: string): Promise<{ message: string }> {
    const startedAt = Date.now();
    const email = normalizeEmail(emailInput);
    const user = await this.User.findOne({ email }).exec();
    const college = user
      ? await this.colleges.findActiveById(user.collegeId)
      : null;
    if (user && college && !user.emailVerifiedAt && user.status === 'active') {
      const rawToken = randomBytes(32).toString('base64url');
      const session = await this.options.connection.startSession();
      try {
        await session.withTransaction(async () => {
          const currentUser = await this.User.findOne({
            _id: user._id,
            collegeId: user.collegeId,
            status: 'active',
            emailVerifiedAt: null,
          })
            .session(session)
            .exec();
          if (!currentUser) return;
          await new this.VerificationToken({
            tokenHash: sha256(rawToken),
            userId: currentUser._id,
            collegeId: currentUser.collegeId,
            expiresAt: new Date(
              this.clock().getTime() + VERIFICATION_TOKEN_TTL_MS,
            ),
            consumedAt: null,
          }).save({ session });
          await this.mailOutbox.enqueueVerificationEmail(
            { to: currentUser.email, name: currentUser.name, token: rawToken },
            { userId: currentUser._id, collegeId: currentUser.collegeId },
            session,
          );
        });
      } finally {
        await session.endSession();
      }
    }
    await minimumElapsed(startedAt, 200);
    return { message: PUBLIC_SIGNUP_MESSAGE };
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = sha256(rawToken);
    const now = this.clock();
    const token = await this.VerificationToken.findOne({
      tokenHash,
      consumedAt: null,
      expiresAt: { $gt: now },
    }).exec();
    if (!token) throw new AuthServiceError('INVALID_VERIFICATION_TOKEN');

    const session = await this.options.connection.startSession();
    let verified = false;
    try {
      await session.withTransaction(async () => {
        verified = false;
        const consumed = await this.VerificationToken.findOneAndUpdate(
          {
            _id: token._id,
            collegeId: token.collegeId,
            userId: token.userId,
            consumedAt: null,
            expiresAt: { $gt: now },
          },
          { $set: { consumedAt: now } },
          { returnDocument: 'after', session },
        ).exec();
        if (!consumed) return;

        const userUpdate = await this.User.updateOne(
          {
            _id: token.userId,
            collegeId: token.collegeId,
            status: 'active',
            emailVerifiedAt: null,
          },
          {
            $set: {
              emailVerifiedAt: now,
              roles: ['BUYER', 'SELLER'] satisfies UserRole[],
            },
          },
          { session, runValidators: true },
        ).exec();
        if (userUpdate.matchedCount !== 1) return;
        verified = true;
      });
    } finally {
      await session.endSession();
    }
    if (!verified) throw new AuthServiceError('INVALID_VERIFICATION_TOKEN');
  }

  async login(emailInput: string, password: string): Promise<AuthSession> {
    const email = normalizeEmail(emailInput);
    const user = await this.users.findForLoginByEmail(email);
    if (!user) {
      await verify(await DUMMY_PASSWORD_HASH, password);
      throw new AuthServiceError('INVALID_CREDENTIALS');
    }

    const passwordMatches = await verify(user.passwordHash, password);
    if (!passwordMatches || user.status !== 'active') {
      throw new AuthServiceError('INVALID_CREDENTIALS');
    }
    if (!user.emailVerifiedAt) throw new AuthServiceError('EMAIL_NOT_VERIFIED');

    const college = await this.colleges.findActiveById(user.collegeId);
    if (!college) throw new AuthServiceError('INVALID_CREDENTIALS');

    return this.createSession(user._id, user.collegeId);
  }

  async refresh(rawToken: string): Promise<AuthSession> {
    const tokenHash = sha256(rawToken);
    const now = this.clock();
    const original = await this.RefreshToken.findOne({ tokenHash }).exec();
    if (!original || original.expiresAt.getTime() <= now.getTime()) {
      throw new AuthServiceError('INVALID_REFRESH_TOKEN');
    }
    if (original.revokedAt) {
      await this.handleRefreshReuse(original, now);
      throw new AuthServiceError('INVALID_REFRESH_TOKEN');
    }

    const rawNextToken = randomBytes(48).toString('base64url');
    const session = await this.options.connection.startSession();
    let rotated = false;
    let sessionUser: {
      _id: Types.ObjectId;
      collegeId: Types.ObjectId;
      roles: UserRole[];
    } | null = null;
    try {
      await session.withTransaction(async () => {
        rotated = false;
        sessionUser = null;
        const consumed = await this.RefreshToken.findOneAndUpdate(
          {
            _id: original._id,
            tokenHash,
            userId: original.userId,
            collegeId: original.collegeId,
            revokedAt: null,
            expiresAt: { $gt: now },
          },
          { $set: { revokedAt: now } },
          { returnDocument: 'after', session },
        ).exec();
        if (!consumed) return;

        const user = await this.User.findOne({
          _id: original.userId,
          collegeId: original.collegeId,
          status: 'active',
          emailVerifiedAt: { $ne: null },
        })
          .session(session)
          .exec();
        if (!user) return;

        await new this.RefreshToken({
          tokenHash: sha256(rawNextToken),
          userId: user._id,
          collegeId: user.collegeId,
          familyId: original.familyId,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
          revokedAt: null,
        }).save({ session });
        sessionUser = {
          _id: user._id,
          collegeId: user.collegeId,
          roles: [...user.roles],
        };
        rotated = true;
      });
    } finally {
      await session.endSession();
    }

    if (!rotated || !sessionUser) {
      const latest = await this.RefreshToken.findOne({ tokenHash }).exec();
      if (latest?.revokedAt)
        await this.handleRefreshReuse(latest, this.clock());
      throw new AuthServiceError('INVALID_REFRESH_TOKEN');
    }
    return {
      accessToken: await this.createAccessToken(sessionUser),
      refreshToken: rawNextToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const token = await this.RefreshToken.findOne({
      tokenHash: sha256(rawToken),
    }).exec();
    if (!token) return;
    await this.RefreshToken.updateMany(
      {
        familyId: token.familyId,
        collegeId: token.collegeId,
        userId: token.userId,
        revokedAt: null,
      },
      { $set: { revokedAt: this.clock() } },
    ).exec();
  }

  private async createSession(
    userId: Types.ObjectId,
    collegeId: Types.ObjectId,
  ): Promise<AuthSession> {
    const activeUser = await this.User.findOne({
      _id: userId,
      collegeId,
      status: 'active',
      emailVerifiedAt: { $ne: null },
    }).exec();
    if (!activeUser) throw new AuthServiceError('INVALID_CREDENTIALS');

    const refreshToken = randomBytes(48).toString('base64url');
    await new this.RefreshToken({
      tokenHash: sha256(refreshToken),
      userId,
      collegeId,
      familyId: randomUUID(),
      expiresAt: new Date(this.clock().getTime() + REFRESH_TOKEN_TTL_MS),
      revokedAt: null,
    }).save();
    const accessToken = await this.createAccessToken({
      _id: userId,
      collegeId,
      roles: [...activeUser.roles],
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  private async createAccessToken(user: {
    _id: Types.ObjectId;
    collegeId: Types.ObjectId;
    roles: UserRole[];
  }): Promise<string> {
    const nowSeconds = Math.floor(this.clock().getTime() / 1_000);
    return new SignJWT({
      collegeId: user.collegeId.toString(),
      roles: user.roles,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('campusbid-api')
      .setAudience('campusbid-client')
      .setSubject(user._id.toString())
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + ACCESS_TOKEN_TTL_SECONDS)
      .sign(this.key);
  }

  private async handleRefreshReuse(
    token: RefreshTokenFields & { revokedAt: Date | null; _id: Types.ObjectId },
    now: Date,
  ): Promise<void> {
    if (!token.revokedAt) return;
    const elapsed = now.getTime() - token.revokedAt.getTime();
    if (elapsed >= 0 && elapsed <= REFRESH_REUSE_GRACE_MS) return;
    await this.RefreshToken.updateMany(
      {
        familyId: token.familyId,
        collegeId: token.collegeId,
        userId: token.userId,
        revokedAt: null,
      },
      { $set: { revokedAt: now } },
    ).exec();
  }
}
