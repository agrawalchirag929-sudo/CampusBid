import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import mongoose, { Types } from 'mongoose';
import { createAuctionEngine } from '@campusbid/auction-engine';
import { loadConfig } from '../../../config.js';
import { createCollegeModel } from '../../colleges/model.js';
import { CollegeService } from '../../colleges/service.js';
import { createListingModel } from '../../listings/model.js';
import { createUserModel } from '../../users/model.js';

const catalog = [
  {
    title: 'Engineering Mathematics II: Kreyszig, 10th Edition',
    category: 'textbooks',
    condition: 'good',
    price: 420_00,
  },
  {
    title: 'Engineering Physics Lab Manual with Notes',
    category: 'textbooks',
    condition: 'like-new',
    price: 180_00,
  },
  {
    title: 'Strength of Materials: R.K. Bansal',
    category: 'textbooks',
    condition: 'fair',
    price: 350_00,
  },
  {
    title: 'Data Structures in C: BMSCE CSE Notes Included',
    category: 'textbooks',
    condition: 'good',
    price: 260_00,
  },
  {
    title: 'Signals and Systems Course Pack',
    category: 'textbooks',
    condition: 'like-new',
    price: 220_00,
  },
  {
    title: 'Casio fx-991CW Scientific Calculator',
    category: 'calculators',
    condition: 'like-new',
    price: 1_150_00,
  },
  {
    title: 'Casio fx-991EX Scientific Calculator',
    category: 'calculators',
    condition: 'good',
    price: 850_00,
  },
  {
    title: 'Casio fx-100MS Calculator with Cover',
    category: 'calculators',
    condition: 'fair',
    price: 450_00,
  },
  {
    title: 'Staedtler Mars Drafting Set',
    category: 'lab-equipment',
    condition: 'good',
    price: 650_00,
  },
  {
    title: 'A3 Drawing Board and Mini Drafter',
    category: 'lab-equipment',
    condition: 'good',
    price: 1_200_00,
  },
  {
    title: 'Rotring Tikky Technical Pens Set',
    category: 'lab-equipment',
    condition: 'like-new',
    price: 900_00,
  },
  {
    title: 'White Lab Coat, Size M',
    category: 'lab-equipment',
    condition: 'good',
    price: 300_00,
  },
  {
    title: 'White Lab Coat, Size L',
    category: 'lab-equipment',
    condition: 'like-new',
    price: 400_00,
  },
  {
    title: 'Safety Goggles and Lab Coat Bundle',
    category: 'lab-equipment',
    condition: 'good',
    price: 500_00,
  },
  {
    title: 'Scientific Calculator and Exam Pouch',
    category: 'calculators',
    condition: 'good',
    price: 720_00,
  },
  {
    title: 'Firefox Bad Attitude 26-inch Campus Cycle',
    category: 'cycles',
    condition: 'good',
    price: 5_500_00,
  },
  {
    title: 'Hero Sprint Single-Speed Bicycle',
    category: 'cycles',
    condition: 'fair',
    price: 3_800_00,
  },
  {
    title: 'Decathlon Riverside Campus Cycle',
    category: 'cycles',
    condition: 'like-new',
    price: 6_900_00,
  },
  {
    title: 'USB-C Hub for Hostel Desk Setup',
    category: 'electronics',
    condition: 'good',
    price: 900_00,
  },
  {
    title: 'Scientific Calculator Case and Spare Battery',
    category: 'other',
    condition: 'new',
    price: 120_00,
  },
  {
    title: 'Mechanical Drawing Instruments Set',
    category: 'lab-equipment',
    condition: 'fair',
    price: 320_00,
  },
  {
    title: 'Basic Electronics Lab Component Kit',
    category: 'lab-equipment',
    condition: 'good',
    price: 550_00,
  },
  {
    title: 'Microcontroller Starter Board',
    category: 'electronics',
    condition: 'like-new',
    price: 1_400_00,
  },
  {
    title: 'Campus Rain Cover for Backpack',
    category: 'other',
    condition: 'good',
    price: 250_00,
  },
  {
    title: 'Engineering Graphics Textbook and Sheets',
    category: 'textbooks',
    condition: 'good',
    price: 380_00,
  },
] as const;

async function getOrCreateDemoUser(
  collegeId: Types.ObjectId,
  role: 'SELLER' | 'BUYER',
): Promise<{ email: string; userId: string; password?: string }> {
  const email =
    role === 'SELLER'
      ? 'campusbid.demo.seller@bmsce.ac.in'
      : 'campusbid.demo.buyer@bmsce.ac.in';
  const User = createUserModel(mongoose.connection);
  const existing = await User.findOne({ email }).exec();
  if (existing) {
    if (!existing.collegeId.equals(collegeId)) {
      throw new Error('Existing demo user is attached to another college');
    }
    existing.roles = [role];
    existing.status = 'active';
    existing.emailVerifiedAt ??= new Date();
    await existing.save();
    return { email, userId: existing._id.toString() };
  }
  const password = randomBytes(15).toString('base64url');
  const user = await User.create({
    email,
    passwordHash: await hash(password),
    collegeId,
    roles: [role],
    status: 'active',
    emailVerifiedAt: new Date(),
    name: role === 'SELLER' ? 'CampusBid Demo Seller' : 'CampusBid Demo Buyer',
  });
  return { email, userId: user._id.toString(), password };
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') {
    throw new Error('Demo seed is disabled in production');
  }
  if (!config.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(config.MONGO_URI, { maxPoolSize: 20 });
  try {
    await createCollegeModel(mongoose.connection).init();
    const college = await new CollegeService(mongoose.connection).seedBmsce();
    if (!college)
      throw new Error('BMSCE college seed did not return a college');
    const seller = await getOrCreateDemoUser(college._id, 'SELLER');
    const buyer = await getOrCreateDemoUser(college._id, 'BUYER');
    const sellerId = new Types.ObjectId(seller.userId);
    const Listing = createListingModel(mongoose.connection);
    const engine = createAuctionEngine({ connection: mongoose.connection });
    await Promise.all([Listing.init(), engine.ensureIndexes()]);

    const now = new Date();
    for (const [index, item] of catalog.entries()) {
      const listing = await Listing.findOneAndUpdate(
        { collegeId: college._id, sellerId, title: item.title },
        {
          $setOnInsert: {
            collegeId: college._id,
            sellerId,
            title: item.title,
            description:
              'Well cared for BMSCE campus item. Pickup near the main block; happy to share more details.',
            category: item.category,
            condition: item.condition,
            photos: [],
            createdAt: now,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).exec();
      if (!listing)
        throw new Error('Could not seed demo listing: ' + item.title);
      const existingAuction = await engine.models.Auction.findOne({
        listingId: listing._id,
      }).exec();
      if (existingAuction) continue;
      const startPricePaise = item.price;
      const startsAt = new Date(now.getTime() - 60 * 60 * 1_000);
      const endsAt = new Date(now.getTime() + (index + 1) * 60 * 60 * 1_000);
      await engine.models.Auction.create({
        collegeId: college._id,
        sellerId: listing.sellerId,
        listingId: listing._id,
        status: 'active',
        startPricePaise,
        currentPricePaise: startPricePaise,
        minIncrementPaise: 50,
        startsAt,
        endsAt,
        version: 0,
        currentBidId: null,
        winnerBidId: null,
        extensionCount: 0,
      });
    }

    console.info('Seeded 25 BMSCE demo auctions.');
    for (const demoUser of [seller, buyer]) {
      if (demoUser.password) {
        console.info(
          'Demo login: ' + demoUser.email + ' / ' + demoUser.password,
        );
      } else {
        console.info('Existing demo account unchanged: ' + demoUser.email);
      }
    }
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Demo auction seed failed',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
