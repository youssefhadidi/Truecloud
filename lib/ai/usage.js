/** @format */

import { prisma } from '@/lib/prisma';

function startOfDay(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function readLimits() {
  return {
    dailyLimit: parseInt(process.env.AI_USER_DAILY_REQUESTS || '200', 10),
  };
}

export async function getUserRequestCount(userId) {
  return prisma.aiUsage.count({
    where: { userId, createdAt: { gte: startOfDay() } },
  });
}

export async function getUsageSnapshot(userId) {
  const todayRequests = await getUserRequestCount(userId);
  const { dailyLimit } = readLimits();
  return {
    todayRequests,
    dailyLimit,
    remainingToday: Math.max(0, dailyLimit - todayRequests),
  };
}

export async function assertWithinQuota(userId) {
  const snapshot = await getUsageSnapshot(userId);
  if (snapshot.todayRequests >= snapshot.dailyLimit) {
    return { ok: false, snapshot };
  }
  return { ok: true, snapshot };
}

export async function logUsage({ userId, model }) {
  await prisma.aiUsage.create({
    data: { userId, model: model || '' },
  });
}
