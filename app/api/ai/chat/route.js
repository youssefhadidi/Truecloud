/** @format */

import { NextResponse } from 'next/server';
import { resolve, sep, basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { requireAuthNoActivity } from '@/lib/authCheck';
import { hasRootAccess, checkPathAccess } from '@/lib/pathPermissions';
import { prisma } from '@/lib/prisma';
import { anthropic, resolveModel } from '@/lib/ai/client';
import { buildFileContentBlocks } from '@/lib/ai/contentBlocks';
import { classifyAiFile } from '@/lib/ai/fileTypes';
import { assertWithinQuota, getUsageSnapshot, logUsage } from '@/lib/ai/usage';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const RESOLVED_UPLOAD_DIR = resolve(process.cwd(), UPLOAD_DIR) + sep;
const MAX_INPUT_TOKENS = parseInt(process.env.AI_MAX_INPUT_TOKENS || '40000', 10);
const MAX_OUTPUT = parseInt(process.env.AI_MAX_OUTPUT_TOKENS || '1024', 10);
const MAX_OUTPUT_LONG = parseInt(process.env.AI_MAX_OUTPUT_TOKENS_LONG || '4096', 10);

const SYSTEM_PROMPT =
  'You are a helpful assistant inside Truecloud, a personal file storage app. ' +
  'The user is asking questions about a specific file from their library, which has been attached to the conversation. ' +
  'Be concise, accurate, and grounded in the file. If the file does not contain the answer, say so plainly.';

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

export async function POST(req) {
  const { session, error: authError } = await requireAuthNoActivity();
  if (authError) return authError;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'AI assistant is not configured on this server.' },
      { status: 503 },
    );
  }

  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { requestId, message, model: requestedModel, longAnswer } = body;
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
      error: quota.reason === 'daily'
        ? 'Daily AI usage limit reached.'
        : 'Monthly AI usage limit reached.',
      reason: quota.reason,
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
  const maxTokens = longAnswer ? MAX_OUTPUT_LONG : MAX_OUTPUT;

  let fileBlocks;
  try {
    fileBlocks = await buildFileContentBlocks({
      absolutePath: absolute,
      normalizedPath: normalized,
      fileName,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message || 'Failed to prepare file' }, { status: 400 });
  }

  const chat = await prisma.aiChat.upsert({
    where: { ownerId_filePath: { ownerId: session.user.id, filePath: normalized } },
    update: { model, updatedAt: new Date() },
    create: { ownerId: session.user.id, filePath: normalized, model },
  });

  const history = await prisma.aiMessage.findMany({
    where: { chatId: chat.id },
    orderBy: { createdAt: 'asc' },
  });

  // File blocks ride on the first user message only. Subsequent turns are
  // text-only — that way the file block stays at a stable position so the
  // prompt cache keeps hitting across follow-ups.
  const messages = [];
  let firstUserAttached = false;
  for (const m of history) {
    if (m.role === 'user' && !firstUserAttached) {
      messages.push({
        role: 'user',
        content: [...fileBlocks, { type: 'text', text: m.content }],
      });
      firstUserAttached = true;
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }
  if (!firstUserAttached) {
    messages.push({
      role: 'user',
      content: [...fileBlocks, { type: 'text', text: message }],
    });
  } else {
    messages.push({ role: 'user', content: message });
  }

  try {
    const tc = await anthropic.messages.countTokens({
      model,
      system: SYSTEM_PROMPT,
      messages,
    });
    if ((tc.input_tokens || 0) > MAX_INPUT_TOKENS) {
      return NextResponse.json({
        error: `File + chat history exceeds the AI context limit (${tc.input_tokens} / ${MAX_INPUT_TOKENS} tokens). Clear chat or try a smaller file.`,
        inputTokens: tc.input_tokens,
        limit: MAX_INPUT_TOKENS,
      }, { status: 413 });
    }
  } catch (err) {
    console.warn('[ai/chat] countTokens preflight failed (continuing):', err?.message);
  }

  await prisma.aiMessage.create({
    data: { chatId: chat.id, role: 'user', content: message },
  });

  const userId = session.user.id;

  // Fire-and-forget the stream — chunks flow to the client over WS so this
  // route returns immediately and the browser doesn't need to hold an HTTP
  // connection open for the full reply.
  (async () => {
    try {
      const stream = anthropic.messages.stream({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages,
      });

      stream.on('text', (delta) => {
        global.broadcastToUser?.(userId, {
          type: 'ai-chunk',
          payload: { requestId, chatId: chat.id, delta },
        });
      });

      stream.on('error', (err) => {
        global.broadcastToUser?.(userId, {
          type: 'ai-error',
          payload: { requestId, chatId: chat.id, message: err?.message || 'Stream error' },
        });
      });

      const finalMessage = await stream.finalMessage();
      const fullText = (finalMessage.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const usage = finalMessage.usage || {};

      const costUsd = await logUsage({ userId, model, usage });
      const persisted = await prisma.aiMessage.create({
        data: {
          chatId: chat.id,
          role: 'assistant',
          content: fullText,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
          cacheWriteTokens: usage.cache_creation_input_tokens || 0,
          costUsd,
        },
      });

      const snapshot = await getUsageSnapshot(userId);
      global.broadcastToUser?.(userId, {
        type: 'ai-done',
        payload: {
          requestId,
          chatId: chat.id,
          messageId: persisted.id,
          costUsd,
          usage: {
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cacheRead: usage.cache_read_input_tokens || 0,
            cacheWrite: usage.cache_creation_input_tokens || 0,
          },
          snapshot,
        },
      });
    } catch (err) {
      console.error('[ai/chat] Stream failed:', err);
      global.broadcastToUser?.(userId, {
        type: 'ai-error',
        payload: { requestId, chatId: chat.id, message: err?.message || 'Stream failed' },
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
      costUsd: m.costUsd,
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
