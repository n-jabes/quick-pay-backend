import { getEnv } from './config/env';
import { closeRedis } from './lib/redis';
import { prisma } from './lib/prisma';
import { getLogger } from './lib/logger';
import { createApp } from './app';

async function main() {
  const env = getEnv();
  const log = getLogger();
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, env: env.NODE_ENV }, 'Quick Pay API listening');
  });

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down');
    server.close();
    await prisma.$disconnect();
    await closeRedis();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
