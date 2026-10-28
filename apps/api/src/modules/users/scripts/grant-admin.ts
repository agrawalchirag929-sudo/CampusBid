import mongoose from 'mongoose';
import { loadConfig } from '../../../config.js';
import { UserRepository } from '../repository.js';
import { createUserModel } from '../model.js';

async function main(): Promise<void> {
  const emailInput = process.argv[2];
  if (!emailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
    throw new Error('Usage: pnpm --filter @campusbid/api admin:grant <email>');
  }
  const config = loadConfig();
  if (!config.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(config.MONGO_URI, { maxPoolSize: 20 });
  try {
    await createUserModel(mongoose.connection).init();
    const user = await new UserRepository(
      mongoose.connection,
    ).grantAdminByEmail(emailInput.trim().toLowerCase());
    if (!user)
      throw new Error('No active, verified user with that email exists');
    console.info(`ADMIN granted to ${user.email} in their existing college`);
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'Admin grant failed',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
