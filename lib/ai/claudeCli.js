/** @format */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const BIN = process.env.CLAUDE_BIN || 'claude';
const TURN_TIMEOUT = parseInt(process.env.AI_TURN_TIMEOUT_MS || '120000', 10);

const SAFE_MODEL = /^[a-zA-Z0-9._-]+$/;
const SAFE_SESSION = /^[a-zA-Z0-9._-]+$/;

export class ClaudeCliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'CLAUDE_CLI_ERROR';
  }
}

// Spawn one non-interactive turn against the local `claude` CLI and stream
// text deltas back. Resolves with { sessionId, fullText, durationMs } on
// success or rejects with ClaudeCliError on failure.
export function runClaude(opts) {
  return new Promise((resolve, reject) => {
    const {
      prompt,
      model,
      resumeSessionId,
      allowedDirs = [],
      cwd = process.cwd(),
      onDelta,
      onSessionId,
    } = opts || {};

    if (typeof prompt !== 'string' || !prompt.length) {
      reject(new ClaudeCliError('prompt is required', 'BAD_INPUT'));
      return;
    }

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', 'bypassPermissions',
    ];
    if (model && SAFE_MODEL.test(model)) args.push('--model', model);
    if (resumeSessionId && SAFE_SESSION.test(resumeSessionId)) args.push('--resume', resumeSessionId);
    for (const dir of allowedDirs) args.push('--add-dir', dir);

    let child;
    try {
      child = spawn(BIN, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (err) {
      reject(new ClaudeCliError(`Failed to spawn ${BIN}: ${err.message}`, 'SPAWN_FAILED'));
      return;
    }

    let sessionId = null;
    let fullText = '';
    let resultDurationMs = 0;
    let resultSeen = false;
    let resultErr = null;
    let stderrTail = '';
    let settled = false;

    const startedAt = Date.now();
    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { reader.close(); } catch {}
      fn(val);
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      settle(reject, new ClaudeCliError(`Claude CLI timed out after ${TURN_TIMEOUT}ms`, 'TIMEOUT'));
    }, TURN_TIMEOUT);

    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      if (settled || !line.trim()) return;
      let evt;
      try { evt = JSON.parse(line); } catch { return; }

      if (evt.type === 'system' && evt.subtype === 'init' && evt.session_id) {
        sessionId = evt.session_id;
        onSessionId?.(sessionId);
        return;
      }

      // Partial assistant updates — extract text_delta tokens
      if (evt.type === 'stream_event' && evt.event) {
        const e = evt.event;
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
          fullText += e.delta.text;
          try { onDelta?.(e.delta.text); } catch {}
        }
        return;
      }

      // Fallback for builds that don't emit partial messages: full assistant turn arrives once
      if (evt.type === 'assistant' && evt.message?.content && !fullText) {
        for (const block of evt.message.content) {
          if (block.type === 'text' && block.text) {
            fullText += block.text;
            try { onDelta?.(block.text); } catch {}
          }
        }
        return;
      }

      if (evt.type === 'result') {
        resultSeen = true;
        resultDurationMs = evt.duration_ms || (Date.now() - startedAt);
        if (evt.session_id && !sessionId) sessionId = evt.session_id;
        if (evt.is_error) {
          resultErr = new ClaudeCliError(
            typeof evt.result === 'string' && evt.result
              ? evt.result
              : `Claude CLI returned an error (${evt.subtype || 'unknown'})`,
            evt.subtype || 'CLI_ERROR',
          );
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrTail += chunk.toString();
      if (stderrTail.length > 8192) stderrTail = stderrTail.slice(-8192);
    });

    child.on('error', (err) => {
      settle(reject, new ClaudeCliError(
        err.code === 'ENOENT'
          ? `Claude CLI binary not found (looked for "${BIN}"). Set CLAUDE_BIN to its absolute path.`
          : `Claude CLI process error: ${err.message}`,
        'PROCESS_ERROR',
      ));
    });

    child.on('close', (code) => {
      if (settled) return;
      if (resultErr) { settle(reject, resultErr); return; }
      if (!resultSeen) {
        const detail = stderrTail.trim().slice(-500) || `exited with code ${code}`;
        settle(reject, new ClaudeCliError(`Claude CLI ended unexpectedly: ${detail}`, 'NO_RESULT'));
        return;
      }
      settle(resolve, { sessionId, fullText, durationMs: resultDurationMs });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
