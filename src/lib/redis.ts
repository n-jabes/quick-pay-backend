import Redis from 'ioredis';
import { getEnv } from '../config/env';
import { getLogger } from './logger';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  const env = getEnv();
  client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  client.on('error', (err) => {
    getLogger().error({ err }, 'Redis connection error');
  });
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
