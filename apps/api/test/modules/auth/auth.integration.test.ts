import { createHash } from 'node:crypto';
import { Algorithm, hash } from '@node-rs/argon2';
import { SignJWT } from 'jose';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { createCollegeModel } from '../../../src/modules/colleges/model.js';
import { createUserModel } from '../../../src/modules/users/model.js';
import { createAuthModels } from '../../../src/modules/auth/models.js';
import type { MailProvider } from '../../../src/modules/auth/mail-provider.js';
import { MailOutboxWorker } from '../../../src/modules/notifications/worker.js';
import { createAuctionModels } from '@campusbid/auction-engine';
import { startMongoReplicaSet } from '../../helpers/mongo-replset.js';

const PASSWORD = 'Secure-CampusBid-Password-2026!';
const HASH_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const jwtKey = new TextEncoder().encode(process.env.JWT_SECRET);
let sequence = 0;
let clockNow = new Date();

class RecordingMailProvider implements MailProvider {
  readonly sent: Array<{ to: string; name: string; token: string }> = [];
  async sendVerificationEmail(message: {
    to: string;
    name: string;
    token: string;
  }): Promise<void> {
    this.sent.push(message);
  }
}

const mail = new RecordingMailProvider();
const User = createUserModel(mongoose.connection);
const College = createCollegeModel(mongoose.connection);
const { VerificationToken, RefreshToken, MailOutbox } = createAuthModels(
  mongoose.connection,
);
const { Auction } = createAuctionModels(mongoose.connection);
const mailWorker = new MailOutboxWorker(
  MailOutbox,
  mail,
  process.env.MAIL_OUTBOX_KEY ?? '',
  { error: () => undefined },
);
const api = createApp({ clock: () => new Date(clockNow) });
let collegeA: Types.ObjectId;
let collegeB: Types.ObjectId;
let stopReplicaSet: (() => Promise<void>) | undefined;

function email(prefix: string, domain = 'bmsce.ac.in'): string {
  sequence += 1;
  return `${prefix}-${sequence}@${domain}`;
}

function cookieFrom(response: request.Response): string {
  const setCookie = response.headers['set-cookie'];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('Expected refresh cookie');
  return header.split(';', 1)[0] ?? '';
}

function rawRefreshCookie(cookie: string): string {
  return cookie.slice(cookie.indexOf('=') + 1);
}

async function accessToken(
  userId: Types.ObjectId,
  userCollegeId: Types.ObjectId,
  exp = '15m',
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ collegeId: userCollegeId.toString(), roles: ['BUYER'] })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('campusbid-api')
    .setAudience('campusbid-client')
    .setSubject(userId.toString())
    .setIssuedAt(now)
    .setExpirationTime(exp === 'expired' ? now - 1 : exp)
    .sign(jwtKey);
}

async function createUser(options: {
  email: string;
  collegeId?: Types.ObjectId;
  roles?: Array<'BUYER' | 'SELLER' | 'ADMIN'>;
  status?: 'active' | 'banned';
  verified?: boolean;
  password?: string;
}) {
  const user = new User({
    email: options.email.trim().toLowerCase(),
    passwordHash: await hash(options.password ?? PASSWORD, HASH_OPTIONS),
    collegeId: options.collegeId ?? collegeA,
    roles: options.roles ?? ['BUYER', 'SELLER'],
    status: options.status ?? 'active',
    emailVerifiedAt: options.verified === false ? null : new Date(),
    name: 'Test Campus User',
  });
  await user.save();
  return user;
}

function login(userEmail: string, password = PASSWORD) {
  return request(api).post('/auth/login').send({ email: userEmail, password });
}

async function signUpAndVerify(userEmail = email('flow')) {
  const signup = await request(api)
    .post('/auth/signup')
    .send({ name: 'Flow Test', email: userEmail, password: PASSWORD })
    .expect(202);
  await mailWorker.processBatch(100);
  expect(signup.body).toEqual({
    message:
      'If the address is eligible, we will send verification instructions.',
  });
  const sent = mail.sent.at(-1);
  if (!sent) throw new Error('Expected a verification email');
  await request(api)
    .post('/auth/verify-email')
    .send({ token: sent.token })
    .expect(204);
  return { userEmail, verificationToken: sent.token };
}

async function createAuction(collegeId: Types.ObjectId) {
  return Auction.create({
    collegeId,
    sellerId: new Types.ObjectId(),
    listingId: new Types.ObjectId(),
    status: 'active',
    startPricePaise: 1_000,
    currentPricePaise: 1_000,
    minIncrementPaise: 100,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 3_600_000),
    version: 0,
    currentBidId: null,
    winnerBidId: null,
    extensionCount: 0,
  });
}

beforeAll(async () => {
  const replicaSet = await startMongoReplicaSet();
  stopReplicaSet = async () => {
    await replicaSet.stop();
  };
  await mongoose.connect(replicaSet.getUri(), { maxPoolSize: 100 });
  await Promise.all([
    College.init(),
    User.init(),
    VerificationToken.init(),
    RefreshToken.init(),
    MailOutbox.init(),
    Auction.init(),
  ]);
  const bmsce = await College.findOneAndUpdate(
    { slug: 'bmsce' },
    {
      $setOnInsert: {
        name: 'BMS College of Engineering',
        slug: 'bmsce',
        emailDomains: ['bmsce.ac.in'],
        active: true,
      },
    },
    { upsert: true, returnDocument: 'after' },
  ).exec();
  if (!bmsce) throw new Error('BMSCE fixture could not be created');
  collegeA = bmsce._id;
  const other = await College.create({
    name: 'Other College',
    slug: 'other-college',
    emailDomains: ['other.edu'],
    active: true,
  });
  collegeB = other._id;
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await stopReplicaSet?.();
});

describe('authentication and college-scoped API', () => {
  it('queues encrypted verification mail and clears its payload after delivery', async () => {
    const userEmail = email('queued-mail');
    await request(api)
      .post('/auth/signup')
      .send({ name: 'Queued User', email: userEmail, password: PASSWORD })
      .expect(202);

    const user = await User.findOne({ email: userEmail }).exec();
    if (!user) throw new Error('Expected signup user');
    const tokenRecord = await VerificationToken.findOne({
      userId: user._id,
    }).exec();
    const queuedJob = await MailOutbox.findOne({ userId: user._id }).exec();
    if (!tokenRecord || !queuedJob?.encryptedPayload) {
      throw new Error('Expected hashed verification token and queued mail');
    }
    expect(queuedJob.encryptedPayload).not.toContain(userEmail);
    expect(tokenRecord.tokenHash).toMatch(/^[\da-f]{64}$/);
    expect(tokenRecord.toObject()).not.toHaveProperty('token');

    expect(await mailWorker.processBatch(10)).toBe(1);
    const deliveredJob = await MailOutbox.findById(queuedJob._id).exec();
    expect(deliveredJob?.deliveredAt).toBeInstanceOf(Date);
    expect(deliveredJob?.encryptedPayload).toBeNull();
    const deliveredMessage = mail.sent.find(
      (message) => message.to === userEmail,
    );
    expect(deliveredMessage).toBeDefined();
    expect(tokenRecord.tokenHash).toBe(
      createHash('sha256')
        .update(deliveredMessage?.token ?? '')
        .digest('hex'),
    );
  });

  it('retries failed outbox delivery after backoff', async () => {
    const userEmail = email('retry-mail');
    await request(api)
      .post('/auth/signup')
      .send({ name: 'Retry User', email: userEmail, password: PASSWORD })
      .expect(202);
    const user = await User.findOne({ email: userEmail }).exec();
    if (!user) throw new Error('Expected retry test user');
    const job = await MailOutbox.findOne({ userId: user._id }).exec();
    if (!job) throw new Error('Expected retry test outbox job');

    let providerCalls = 0;
    const workerErrors: string[] = [];
    const now = new Date();
    const retryWorker = new MailOutboxWorker(
      MailOutbox,
      {
        async sendVerificationEmail() {
          providerCalls += 1;
          if (providerCalls === 1)
            throw new Error('temporary provider failure');
        },
      },
      process.env.MAIL_OUTBOX_KEY ?? '',
      { error: (_fields, message) => workerErrors.push(message) },
      () => new Date(now),
    );

    expect(await retryWorker.processBatch(1)).toBe(1);
    const deferred = await MailOutbox.findById(job._id).exec();
    expect(deferred?.attempts).toBe(1);
    expect(deferred?.lockedAt).toBeNull();
    expect(deferred?.encryptedPayload).toBeTruthy();
    expect(deferred?.availableAt.getTime()).toBe(now.getTime() + 1_000);
    expect(await retryWorker.processBatch(1)).toBe(0);

    now.setTime(now.getTime() + 1_001);
    expect(await retryWorker.processBatch(1)).toBe(1);
    const delivered = await MailOutbox.findById(job._id).exec();
    expect(providerCalls).toBe(2);
    expect(workerErrors).toEqual([
      'Mail delivery failed; job scheduled for retry',
    ]);
    expect(delivered?.deliveredAt).toBeInstanceOf(Date);
    expect(delivered?.encryptedPayload).toBeNull();
  });
  it('completes signup, single-use verification, login, /me, refresh, and logout', async () => {
    const registered = await signUpAndVerify();
    await request(api)
      .post('/auth/verify-email')
      .send({ token: registered.verificationToken })
      .expect(400);

    const signedIn = await login(registered.userEmail).expect(200);
    const refreshCookie = cookieFrom(signedIn);
    expect(signedIn.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    const refreshSetCookie = signedIn.headers['set-cookie']?.[0] ?? '';
    expect(refreshSetCookie).toContain('HttpOnly');
    expect(refreshSetCookie).toContain('Secure');
    expect(refreshSetCookie).toContain('SameSite=Lax');
    expect(refreshSetCookie).toContain('Path=/');
    expect(refreshSetCookie).not.toContain('Domain=');

    const me = await request(api)
      .get('/me')
      .set('Authorization', `Bearer ${signedIn.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({
      email: registered.userEmail,
      roles: ['BUYER', 'SELLER'],
      collegeId: collegeA.toString(),
    });
    expect(me.body).not.toHaveProperty('passwordHash');

    const refreshed = await request(api)
      .post('/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    const rotatedCookie = cookieFrom(refreshed);
    expect(rotatedCookie).not.toBe(refreshCookie);
    const oldRecord = await RefreshToken.findOne({
      tokenHash: createHash('sha256')
        .update(rawRefreshCookie(refreshCookie))
        .digest('hex'),
    }).exec();
    expect(oldRecord?.revokedAt).toBeInstanceOf(Date);
    expect(oldRecord?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await request(api)
      .post('/auth/logout')
      .set('Cookie', rotatedCookie)
      .expect(204);
    await request(api)
      .post('/auth/refresh')
      .set('Cookie', rotatedCookie)
      .expect(401);
  });

  it('rejects unsupported exact domains, weak passwords, and client college fields', async () => {
    for (const rejectedEmail of [
      'student@evilbmsce.ac.in',
      'student@mail.bmsce.ac.in',
    ]) {
      await request(api)
        .post('/auth/signup')
        .send({ name: 'Student', email: rejectedEmail, password: PASSWORD })
        .expect(400);
    }
    await request(api)
      .post('/auth/signup')
      .send({ name: 'Student', email: email('weak'), password: 'short' })
      .expect(400);
    await request(api)
      .post('/auth/signup')
      .send({
        name: 'Student',
        email: email('spoof'),
        password: PASSWORD,
        collegeId: collegeB.toString(),
      })
      .expect(400);
  });

  it('returns the unverified message only after validating the password', async () => {
    const unverifiedEmail = email('unverified');
    await createUser({ email: unverifiedEmail, verified: false });
    const wrongPassword = await login(
      unverifiedEmail,
      'incorrect-password',
    ).expect(401);
    expect(wrongPassword.body).toEqual({ error: 'Invalid email or password' });
    const correctPassword = await login(unverifiedEmail).expect(403);
    expect(correctPassword.body).toEqual({
      error: 'Verify your email before logging in',
    });
  });

  it('keeps signup responses and rough timing similar for existing and new emails', async () => {
    const existingEmail = email('already-registered');
    await createUser({ email: existingEmail, verified: false });
    const existingTimes: number[] = [];
    const newTimes: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const existingStart = Date.now();
      const existing = await request(api)
        .post('/auth/signup')
        .send({ name: 'Person', email: existingEmail, password: PASSWORD })
        .expect(202);
      existingTimes.push(Date.now() - existingStart);
      const newStart = Date.now();
      const currentNewEmail = email('new-signup');
      const created = await request(api)
        .post('/auth/signup')
        .send({ name: 'Person', email: currentNewEmail, password: PASSWORD })
        .expect(202);
      newTimes.push(Date.now() - newStart);
      expect(existing.body).toEqual(created.body);
    }
    const median = (values: number[]) =>
      [...values].sort((left, right) => left - right)[1] ?? 0;
    expect(Math.abs(median(existingTimes) - median(newTimes))).toBeLessThan(
      600,
    );
  }, 30_000);

  it('keeps unknown and wrong-password login responses and rough timing similar', async () => {
    const knownEmail = email('known-login');
    await createUser({ email: knownEmail });
    const unknownEmail = email('unknown-login');
    const knownTimes: number[] = [];
    const unknownTimes: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      let started = Date.now();
      const known = await login(knownEmail, 'incorrect-password').expect(401);
      knownTimes.push(Date.now() - started);
      started = Date.now();
      const unknown = await login(unknownEmail, 'incorrect-password').expect(
        401,
      );
      unknownTimes.push(Date.now() - started);
      expect(known.body).toEqual(unknown.body);
    }
    const median = (values: number[]) =>
      [...values].sort((left, right) => left - right)[1] ?? 0;
    expect(Math.abs(median(knownTimes) - median(unknownTimes))).toBeLessThan(
      600,
    );
  }, 30_000);

  it('returns identical resend responses for unknown and known addresses', async () => {
    const unverifiedEmail = email('resend');
    await createUser({ email: unverifiedEmail, verified: false });
    const beforeKnown = await MailOutbox.countDocuments().exec();
    const known = await request(api)
      .post('/auth/resend-verification')
      .send({ email: unverifiedEmail })
      .expect(202);
    const afterKnown = await MailOutbox.countDocuments().exec();
    const unknown = await request(api)
      .post('/auth/resend-verification')
      .send({ email: email('nobody') })
      .expect(202);
    expect(known.body).toEqual(unknown.body);
    expect(afterKnown).toBe(beforeKnown + 1);
    expect(await MailOutbox.countDocuments().exec()).toBe(afterKnown);
  });

  it('rejects tampered, expired, and deleted-user access tokens', async () => {
    const user = await createUser({ email: email('jwt') });
    const goodToken = await accessToken(user._id, collegeA);
    const pieces = goodToken.split('.');
    const payload = pieces[1] ?? '';
    pieces[1] = `${payload[0] === 'a' ? 'b' : 'a'}${payload.slice(1)}`;
    await request(api)
      .get('/me')
      .set('Authorization', `Bearer ${pieces.join('.')}`)
      .expect(401);
    await request(api)
      .get('/me')
      .set(
        'Authorization',
        `Bearer ${await accessToken(user._id, collegeA, 'expired')}`,
      )
      .expect(401);
    const deletedToken = await accessToken(user._id, collegeA);
    await User.deleteOne({ _id: user._id, collegeId: collegeA }).exec();
    await request(api)
      .get('/me')
      .set('Authorization', `Bearer ${deletedToken}`)
      .expect(401);
  });

  it('returns 401 when the same refresh token is used concurrently but leaves the new token usable', async () => {
    const userEmail = email('parallel-refresh');
    await createUser({ email: userEmail });
    const signedIn = await login(userEmail).expect(200);
    const oldCookie = cookieFrom(signedIn);
    const results = await Promise.all([
      request(api).post('/auth/refresh').set('Cookie', oldCookie),
      request(api).post('/auth/refresh').set('Cookie', oldCookie),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
    const successful = results.find((response) => response.status === 200);
    if (!successful) throw new Error('One refresh request should succeed');
    const newCookie = cookieFrom(successful);
    await request(api)
      .post('/auth/refresh')
      .set('Cookie', newCookie)
      .expect(200);
  }, 30_000);

  it('revokes the whole refresh family when a rotated token is reused after the grace window', async () => {
    clockNow = new Date();
    const userEmail = email('grace-refresh');
    await createUser({ email: userEmail });
    const signedIn = await login(userEmail).expect(200);
    const oldCookie = cookieFrom(signedIn);
    const rotated = await request(api)
      .post('/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(200);
    const newCookie = cookieFrom(rotated);

    clockNow = new Date(clockNow.getTime() + 10_001);
    await request(api)
      .post('/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(401);
    await request(api)
      .post('/auth/refresh')
      .set('Cookie', newCookie)
      .expect(401);
  }, 30_000);

  it('keeps admin user listing and ban operations inside the admin college', async () => {
    const admin = await createUser({
      email: email('admin-a'),
      collegeId: collegeA,
      roles: ['ADMIN', 'BUYER'],
    });
    const sameCollege = await createUser({
      email: email('member-a'),
      collegeId: collegeA,
    });
    const otherCollege = await createUser({
      email: email('member-b', 'other.edu'),
      collegeId: collegeB,
    });
    const adminLogin = await login(admin.email).expect(200);
    const adminAccess = adminLogin.body.accessToken as string;
    const sameCollegeLogin = await login(sameCollege.email).expect(200);
    const sameCollegeRefresh = cookieFrom(sameCollegeLogin);

    const listing = await request(api)
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    expect(
      listing.body.users.some(
        (user: { email: string }) => user.email === sameCollege.email,
      ),
    ).toBe(true);
    expect(
      listing.body.users.some(
        (user: { email: string }) => user.email === otherCollege.email,
      ),
    ).toBe(false);
    await request(api)
      .post(`/admin/users/${otherCollege._id.toString()}/ban`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(404);
    expect((await User.findById(otherCollege._id).exec())?.status).toBe(
      'active',
    );

    await request(api)
      .get('/admin/users')
      .set(
        'Authorization',
        `Bearer ${sameCollegeLogin.body.accessToken as string}`,
      )
      .expect(403);
    await request(api)
      .post(`/admin/users/${sameCollege._id.toString()}/ban`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
    await request(api)
      .post('/auth/refresh')
      .set('Cookie', sameCollegeRefresh)
      .expect(401);
    await login(sameCollege.email).expect(401);
    await request(api)
      .post(`/admin/users/${sameCollege._id.toString()}/unban`)
      .set('Authorization', `Bearer ${adminAccess}`)
      .expect(200);
  });

  it('maps a cross-college bid to 404 and keeps admin resources college-scoped', async () => {
    const userEmail = email('college-a-bidder');
    const user = await createUser({ email: userEmail, collegeId: collegeA });
    const signedIn = await login(userEmail).expect(200);
    const auction = await createAuction(collegeB);
    await request(api)
      .post(`/auctions/${auction._id.toString()}/bids`)
      .set('Authorization', `Bearer ${signedIn.body.accessToken as string}`)
      .set('Idempotency-Key', 'cross-college-bid')
      .send({ amountPaise: 1_000 })
      .expect(404);
    expect(user.collegeId.toString()).not.toBe(auction.collegeId.toString());
  });
});
