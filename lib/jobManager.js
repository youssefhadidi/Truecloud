/** @format */

/**
 * Job Manager
 *
 * Generic in-memory registry for tracking long-running external processes.
 * Uses global state so the registry survives Next.js hot-reloads in dev.
 *
 * Job types: 'cache-generation', 'transcode', 'hls-transcode', 'install-requirement', ...
 *
 * Usage:
 *   import { createJob, startJob, addJobLog, completeJob } from '@/lib/jobManager';
 *   const id = createJob('My Job', 'my-type');
 *   startJob(id);
 *   addJobLog(id, 'Starting…');
 *   completeJob(id, true);
 */

import { randomUUID } from 'crypto';

// ─── Global registry ──────────────────────────────────────────────────────────
// Persists across Next.js hot-reloads. Capped at MAX_JOBS entries.

const MAX_JOBS = 100;

global.jobs ??= new Map();

// ─── Serialisation ────────────────────────────────────────────────────────────

function serialize(job) {
  const { _child, ...rest } = job;
  return rest;
}

// ─── Broadcast helper ─────────────────────────────────────────────────────────

function broadcastJob(id) {
  const job = global.jobs.get(id);
  if (!job) return;
  if (typeof global.broadcastJobUpdate === 'function') {
    global.broadcastJobUpdate(serialize(job));
  }
}

// ─── Lifecycle helpers ────────────────────────────────────────────────────────

/**
 * Create a new job entry.
 * @param {string} name   Human-readable label (e.g. filename or "Cache Generation")
 * @param {string} type   Machine type string for filtering (e.g. 'hls-transcode')
 * @param {{ id?: string }} [opts]  Pass a stable `id` to allow idempotent upserts
 * @returns {string} jobId
 */
export function createJob(name, type, { id } = {}) {
  const jobId = id ?? randomUUID();

  // Evict oldest completed/failed jobs when over cap
  if (global.jobs.size >= MAX_JOBS) {
    for (const [key, job] of global.jobs) {
      if (job.status !== 'running' && job.status !== 'pending') {
        global.jobs.delete(key);
        break;
      }
    }
  }

  global.jobs.set(jobId, {
    id: jobId,
    name,
    type,
    status: 'pending',
    progress: 0,
    logs: [],
    error: null,
    startTime: null,
    endTime: null,
    _child: null,
  });

  broadcastJob(jobId);
  return jobId;
}

/**
 * Mark a job as running and record its start time.
 */
export function startJob(id) {
  const job = global.jobs.get(id);
  if (!job) return;
  job.status = 'running';
  job.startTime = new Date().toISOString();
  broadcastJob(id);
}

/**
 * Associate a child process with a job (enables cancellation).
 */
export function setJobChild(id, childProcess) {
  const job = global.jobs.get(id);
  if (!job) return;
  job._child = childProcess;
}

/**
 * Append a log line to the job.
 */
export function addJobLog(id, message, level = 'info') {
  const job = global.jobs.get(id);
  if (!job) return;
  job.logs.push({ time: new Date().toISOString(), message: String(message), level });
  broadcastJob(id);
}

/**
 * Update the progress percentage (0–100). Does not broadcast on every tick
 * to avoid flooding; callers should batch or throttle as needed.
 * Set `broadcast` to true to force a broadcast.
 */
export function setJobProgress(id, progress, broadcast = false) {
  const job = global.jobs.get(id);
  if (!job) return;
  job.progress = Math.min(100, Math.max(0, progress));
  if (broadcast) broadcastJob(id);
}

/**
 * Mark a job as completed (success or failure).
 */
export function completeJob(id, success, error = null) {
  const job = global.jobs.get(id);
  if (!job) return;
  job.status = success ? 'completed' : 'failed';
  job.progress = success ? 100 : job.progress;
  job.error = error ?? null;
  job.endTime = new Date().toISOString();
  job._child = null;
  broadcastJob(id);
}

/**
 * Cancel a running job: sends SIGTERM to its child process and marks it cancelled.
 */
export function cancelJob(id) {
  const job = global.jobs.get(id);
  if (!job) return false;
  if (job._child) {
    try {
      job._child.kill('SIGTERM');
    } catch {
      // process may have already exited
    }
  }
  job.status = 'cancelled';
  job.endTime = new Date().toISOString();
  job._child = null;
  broadcastJob(id);
  return true;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getJob(id) {
  const job = global.jobs.get(id);
  return job ? serialize(job) : null;
}

/** Returns all jobs newest-first (by startTime, then creation order). */
export function listJobs() {
  const all = Array.from(global.jobs.values()).map(serialize);
  return all.reverse();
}

// ─── Cache generation observer ────────────────────────────────────────────────

const CACHE_JOB_ID = 'cache-generation';

/**
 * Mirror global.cacheGenerationStatus into the job manager.
 * Called by server.js after every broadcastCacheGenerationUpdate().
 * Uses a stable job ID so repeated calls update the same entry.
 */
export function syncCacheJobToManager(status) {
  if (!status) return;

  const existing = global.jobs.get(CACHE_JOB_ID);

  if (status.isRunning) {
    if (!existing || existing.status !== 'running') {
      createJob('Cache Generation', 'cache-generation', { id: CACHE_JOB_ID });
      startJob(CACHE_JOB_ID);
    }
    if (status.currentFile) {
      const job = global.jobs.get(CACHE_JOB_ID);
      if (job) {
        const total = status.total || 0;
        const processed = status.processed || 0;
        const progress = total > 0 ? Math.min(99, Math.round((processed / total) * 100)) : 0;
        // Only log meaningful progress changes (every 5% or new file)
        const lastLog = job.logs[job.logs.length - 1];
        const msg = `[${processed}/${total}] ${status.currentFile}`;
        if (!lastLog || lastLog.message !== msg) {
          addJobLog(CACHE_JOB_ID, msg, 'info');
        }
        setJobProgress(CACHE_JOB_ID, progress, true);
      }
    }
  } else if (existing && existing.status === 'running') {
    if (status.error) {
      addJobLog(CACHE_JOB_ID, status.error, 'error');
      completeJob(CACHE_JOB_ID, false, status.error);
    } else {
      const summary = `Completed: ${status.successful ?? 0} succeeded, ${status.failed ?? 0} failed, ${status.skipped ?? 0} skipped`;
      addJobLog(CACHE_JOB_ID, summary, 'info');
      completeJob(CACHE_JOB_ID, status.success !== false);
    }
  }
}
