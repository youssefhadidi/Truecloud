/** @format */

import { prisma } from '@/lib/prisma';
import { computeCost } from './pricing';

function startOfDay(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function startOfMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function readLimits() {
  return {
    dailyLimit: parseFloat(process.env.AI_USER_DAILY_USD || '0.50'),
    monthlyLimit: parseFloat(process.env.AI_USER_MONTHLY_USD || '5.00'),
  };
}

export async function getUserSpend(userId) {
  const [day, month] = await Promise.all([
    prisma.aiUsage.aggregate({
      where: { userId, createdAt: { gte: startOfDay() } },
      _sum: { costUsd: true },
    }),
    prisma.aiUsage.aggregate({
      where: { userId, createdAt: { gte: startOfMonth() } },
      _sum: { costUsd: true },
    }),
  ]);
  return {
    todayUsd: day._sum.costUsd || 0,
    monthUsd: month._sum.costUsd || 0,
  };
}

export async function getUsageSnapshot(userId) {
  const { todayUsd, monthUsd } = await getUserSpend(userId);
  const { dailyLimit, monthlyLimit } = readLimits();
  return {
    todayUsd,
    monthUsd,
    dailyLimit,
    monthlyLimit,
    remainingDayUsd: Math.max(0, dailyLimit - todayUsd),
    remainingMonthUsd: Math.max(0, monthlyLimit - monthUsd),
  };
}

export async function assertWithinQuota(userId) {
  const snap = await getUsageSnapshot(userId);
  if (snap.todayUsd >= snap.dailyLimit) {
    return { ok: false, reason: 'daily', snapshot: snap };
  }
  if (snap.monthUsd >= snap.monthlyLimit) {
    return { ok: false, reason: 'monthly', snapshot: snap };
  }
  return { ok: true, snapshot: snap };
}

export async function logUsage({ userId, model, usage }) {
  const costUsd = computeCost(model, usage);
  await prisma.aiUsage.create({
    data: {
      userId,
      model,
      inputTokens: usage?.input_tokens || 0,
      outputTokens: usage?.output_tokens || 0,
      cacheReadTokens: usage?.cache_read_input_tokens || 0,
      cacheWriteTokens: usage?.cache_creation_input_tokens || 0,
      costUsd,
    },
  });
  return costUsd;
}
