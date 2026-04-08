import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const globalForPool = globalThis as unknown as { prismaPgPool?: Pool };

const prismaPgPool =
  globalForPool.prismaPgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPool.prismaPgPool = prismaPgPool;
}

const adapter = new PrismaPg(prismaPgPool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
