import { cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(webRoot, '../..');
const sharedDist = resolve(workspaceRoot, 'packages/shared/dist');
const injectedSharedDist = resolve(
  webRoot,
  'node_modules/@campusbid/shared/dist',
);

await cp(sharedDist, injectedSharedDist, { recursive: true, force: true });
