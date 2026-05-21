/** @format */

import { NextResponse } from 'next/server';
import { resolve, sep, basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { prisma } from '@/lib/prisma';
import { runClaude } from '@/lib/ai/claudeCli';
import { classifyAiFile } from '@/lib/ai/fileTypes';
import { xlsxToText } from '@/lib/ai/xlsx';
import { assertWithinQuota, getUsageSnapshot, logUsage } from '@/lib/ai/usage';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
const UPLOAD_DIR_ABS = resolve(process.cwd(), UPLOAD_DIR);

const ALLOWED_MODELS = new Set(['sonnet', 'haiku', 'opus']);
const DEFAULT_MODEL = process.env.AI_DEFAULT_MODEL || 'sonnet';

function resolveModel(requested) {
  if (requested && ALLOWED_MODELS.has(requested)) return requested;
  return DEFAULT_MODEL;
}

async function resolveAndAuthorizePath(session, rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return { error: NextResponse.json({ error: 'filePath required' }, { status: 400 }) };
  }
  if (rawPath.includes('..')) {
    return { error: NextResponse.json({ error: 'Invalid path' }, { status: 400 }) };
  }
  const isRoot = await hasRootAccess(session.user.id);
  const access = checkPathAccess({
    userId: session.user.id,
    path: rawPath,
    operation: 'read',
    isRootUser: isRoot,
  });
  if (!access.allowed) {
    return { error: NextResponse.json({ error: access.error }, { status: access.status }) };
  }
  const normalized = access.normalizedPath.replace(/\\/g, '/');
  const absolute = resolve(process.cwd(), UPLOAD_DIR, normalized);
  if (!(absolute + sep).startsWith(RESOLVED_UPLOAD_DIR)) {
    return { error: NextResponse.json({ error: 'Invalid path' }, { status: 400 }) };
  }
  return { normalized, absolute };
}

function buildFirstTurnPrompt({ kind, fileName, absolutePath, csvText, userMessage }) {
  if (kind === 'xlsx') {
    return [
      'The user is asking about a spreadsheet from their personal file storage.',
      '',
      `Filename: ${fileName}`,
      '',
      'Parsed contents (CSV format):',
      '```',
      csvText,
      '```',
      '',
      'User question:',
      userMessage,
    ].join('\n');
  }
  return [
    'The user is asking about a file in their personal file storage.',
    '',
    `Filename: ${fileName}`,
    `Full path: ${absolutePath}`,
    '',
    "Read the file with your Read tool, then answer the user's question concisely and grounded in the file. If the file does not contain the answer, say so plainly.",
    '',
    'User question:',
    userMessage,
  ].join('\n');
}

export async function POST(req) {
  const { session, error: authError } = await requireAuthNoActivity();
  if (authError) return authError;

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { requestId, message, model: requestedModel } = body;
  if (typeof requestId !== 'string' || !requestId) {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 });
  }
  if (typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'message required' }, { status: 400 });
  }
  if (message.length > 8000) {
    return NextResponse.json({ error: 'Message too long (max 8000 chars)' }, { status: 400 });
  }

  const resolved = await resolveAndAuthorizePath(session, body.filePath);
  if (resolved.error) return resolved.error;
  const { normalized, absolute } = resolved;

  if (!existsSync(absolute) || statSync(absolute).isDirectory()) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const quota = await assertWithinQuota(session.user.id);
  if (!quota.ok) {
    return NextResponse.json({
      error: 'Daily AI request limit reached.',
      snapshot: quota.snapshot,
    }, { status: 429 });
  }

  const fileName = basename(normalized);
  const cls = classifyAiFile(fileName);
  if (cls.kind === 'unsupported') {
    return NextResponse.json(
      { error: 'This file type is not supported by the AI assistant.' },
      { status: 400 },
    );
  }

  const model = resolveModel(requestedModel);

  const chat = await prisma.aiChat.upsert({
    where: { ownerId_filePath: { ownerId: session.user.id, filePath: normalized } },
    update: { model, updatedAt: new Date() },
    create: { ownerId: session.user.id, filePath: normalized, model },
  });

  let prompt;
  try {
    if (!chat.claudeSessionId) {
      if (cls.kind === 'xlsx') {
        const csvText = await xlsxToText(absolute, fileName);
        prompt = buildFirstTurnPrompt({ kind: 'xlsx', fileName, csvText, userMessage: message });
      } else {
        prompt = buildFirstTurnPrompt({ kind: cls.kind, fileName, absolutePath: absolute, userMessage: message });
      }
    } else {
      prompt = message;
    }
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to prepare file' }, { status: 400 });
  }

  await prisma.aiMessage.create({
    data: { chatId: chat.id, role: 'user', content: message },
  });
  await logUsage({ userId: session.user.id, model });

  const userId = session.user.id;

  (async () => {
    try {
      const result = await runClaude({
        prompt,
        model,
        resumeSessionId: chat.claudeSessionId || undefined,
        allowedDirs: [UPLOAD_DIR_ABS],
        cwd: UPLOAD_DIR_ABS,
        onDelta: (delta) => {
          global.broadcastToUser?.(userId, {
            type: 'ai-chunk',
            payload: { requestId, chatId: chat.id, delta },
          });
        },
      });

      if (result.sessionId && result.sessionId !== chat.claudeSessionId) {
        await prisma.aiChat.update({
          where: { id: chat.id },
          data: { claudeSessionId: result.sessionId, updatedAt: new Date() },
        });
      }

      const persisted = await prisma.aiMessage.create({
        data: { chatId: chat.id, role: 'assistant', content: result.fullText },
      });

      const snapshot = await getUsageSnapshot(userId);
      global.broadcastToUser?.(userId, {
        type: 'ai-done',
        payload: {
          requestId,
          chatId: chat.id,
          messageId: persisted.id,
          durationMs: result.durationMs,
          snapshot,
        },
      });
    } catch (err) {
      console.error('[ai/chat] Claude CLI failed:', err);
      global.broadcastToUser?.(userId, {
        type: 'ai-error',
        payload: { requestId, chatId: chat.id, message: err?.message || 'Claude CLI failed' },
      });
    }
  })();

  return NextResponse.json({ ok: true, requestId, chatId: chat.id });
}

export async function GET(req) {
  const { session, error: authError } = await requireAuthNoActivity();
  if (authError) return authError;

  const url = new URL(req.url);
  const filePath = url.searchParams.get('filePath') || '';
  const resolved = await resolveAndAuthorizePath(session, filePath);
  if (resolved.error) return resolved.error;

  const chat = await prisma.aiChat.findUnique({
    where: { ownerId_filePath: { ownerId: session.user.id, filePath: resolved.normalized } },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  if (!chat) return NextResponse.json({ chat: null, messages: [] });

  return NextResponse.json({
    chat: {
      id: chat.id,
      model: chat.model,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    },
    messages: chat.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  });
}

export async function DELETE(req) {
  const { session, error: authError } = await requireAuthNoActivity();
  if (authError) return authError;

  const url = new URL(req.url);
  const filePath = url.searchParams.get('filePath') || '';
  const resolved = await resolveAndAuthorizePath(session, filePath);
  if (resolved.error) return resolved.error;

  await prisma.aiChat.deleteMany({
    where: { ownerId: session.user.id, filePath: resolved.normalized },
  });
  return NextResponse.json({ ok: true });
}
