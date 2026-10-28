import { loadConfig } from '../../../config.js';
import { CollegeService } from '../service.js';
import { createCollegeModel } from '../model.js';
import mongoose from 'mongoose';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(config.MONGO_URI, { maxPoolSize: 20 });
  try {
    await createCollegeModel(mongoose.connection).init();
    const college = await new CollegeService(mongoose.connection).seedBmsce();
    if (!college)
      throw new Error('BMSCE seed did not create or find the college');
    console.info('BMSCE college seed is ready');
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'BMSCE college seed failed',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
