import { deploymentEnv, routes, type VercelConfig } from '@vercel/config/v1';

const backendUrl = deploymentEnv('BACKEND_URL');

export const config: VercelConfig = {
  rewrites: [
    routes.rewrite('/api/(.*)', backendUrl + '/$1'),
    routes.rewrite('/(.*)', '/index.html'),
  ],
};
