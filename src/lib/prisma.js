import { PrismaClient } from '@/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Single PrismaClient instance reused across hot reloads in development.
 * Prisma 7 requires a driver adapter; we use node-postgres against DATABASE_URL.
 */
const createClient = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
};

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
