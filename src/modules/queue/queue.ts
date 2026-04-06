import { Queue } from 'bullmq';
import { getEnv } from '../../config/env';
import { getRedis } from '../../lib/redis';
import { getLogger } from '../../lib/logger';

let notificationsQueue: Queue | null = null;

export function getNotificationsQueue(): Queue {
  if (notificationsQueue) return notificationsQueue;
  const env = getEnv();
  notificationsQueue = new Queue(`${env.QUEUE_PREFIX}:notifications`, {
    connection: getRedis(),
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
    },
  });
  getLogger().info('BullMQ notifications queue initialized');
  return notificationsQueue;
}
