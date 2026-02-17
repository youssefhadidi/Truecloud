/** @format */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = global;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV !== 'production' ? ['query'] : [],
  });

globalForPrisma.prisma = prisma;
