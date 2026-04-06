import pino from 'pino';
import { getEnv } from '../config/env';

let instance: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (instance) return instance;
  const env = getEnv();
  instance = pino({ level: env.LOG_LEVEL });
  return instance;
}
