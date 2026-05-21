/** @format */

import Anthropic from '@anthropic-ai/sdk';

const globalForAi = global;

export const anthropic =
  globalForAi.__anthropic ||
  new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: {
      'anthropic-beta': 'files-api-2025-04-14',
    },
  });

globalForAi.__anthropic = anthropic;

export const DEFAULT_MODEL =
  process.env.AI_DEFAULT_MODEL || 'claude-haiku-4-5-20251001';

export const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]);

export function resolveModel(requested) {
  if (requested && ALLOWED_MODELS.has(requested)) return requested;
  return DEFAULT_MODEL;
}
