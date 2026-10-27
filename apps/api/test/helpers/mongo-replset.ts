import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export async function startMongoReplicaSet(): Promise<MongoMemoryReplSet> {
  const testTempDirectory = fileURLToPath(
    new URL('../../../work/mongo-temp/', import.meta.url),
  );
  await mkdir(testTempDirectory, { recursive: true });
  process.env.TEMP = testTempDirectory;
  process.env.TMP = testTempDirectory;
  process.env.TMPDIR = testTempDirectory;

  return MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
}
