/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { spawn } from 'child_process';
import { logger } from '@/lib/logger';
import {
  STEPS,
  TARGETS,
  TARGET_LABELS,
  isUpdateRunning,
  startUpdate,
  setCurrentStep,
  completeStep,
  addLog,
  finishUpdate,
} from '@/lib/updateStatus';
import {
  resolveTorrentServicePath,
  detectPackageManager,
  nativeRebuildArgs,
  TORRENT_SERVICE_BRANCH,
} from '@/lib/torrentServiceRepo';

function appSteps() {
  const cwd = process.cwd();
  return [
    { name: STEPS.PULLING, command: 'bun', args: ['run', 'pull'], cwd },
    { name: STEPS.INSTALLING, command: 'bun', args: ['install'], cwd },
    { name: STEPS.REBUILDING, command: 'sh', args: ['-c', 'SHARP_FORCE_GLOBAL_LIBVIPS= bun pm trust --all'], cwd },
    { name: STEPS.DB_MIGRATE, command: 'bun', args: ['run', 'db:migrate'], cwd },
    // Must run BEFORE `build` — next bundles the generated Prisma client into
    // .next at build time. Without this, a schema change applies to the DB
    // but the bundled client has no record of the new model → runtime 500
    // ("undefined is not an object evaluating prisma.<newModel>.<call>").
    { name: STEPS.DB_GENERATE, command: 'bun', args: ['run', 'db:generate'], cwd },
    { name: STEPS.BUILDING, command: 'bun', args: ['run', 'build'], cwd },
    { name: STEPS.RESTARTING, command: 'bun', args: ['run', 'restart'], cwd },
  ];
}

/**
 * torrent-service is a separate Node checkout (see TORRENT.md): no Next build
 * and no Prisma, but its native WebTorrent addon must be rebuilt after install
 * or the service starts and immediately dies on a missing .node binary.
 */
function torrentServiceSteps() {
  const cwd = resolveTorrentServicePath();
  if (!cwd) {
    throw new Error('torrent-service checkout not found. Set TORRENT_SERVICE_PATH to its directory.');
  }

  const pm = detectPackageManager(cwd);
  return [
    // Explicit remote/branch: the checkout may have no upstream tracking set,
    // and --ff-only keeps a deploy from silently creating a merge commit.
    { name: STEPS.PULLING, command: 'git', args: ['pull', '--ff-only', 'origin', TORRENT_SERVICE_BRANCH], cwd },
    { name: STEPS.INSTALLING, command: pm, args: ['install'], cwd },
    // Re-runs node-datachannel's own install script (prebuild-install) in its
    // real directory. The repo's `rebuild-native` script can't be used: it
    // resolves node-datachannel from the project root, which only holds under a
    // hoisted layout — under pnpm it's a transitive dep of webtorrent and never
    // appears there.
    { name: STEPS.REBUILDING, command: pm, args: nativeRebuildArgs(pm), cwd },
    { name: STEPS.RESTARTING, command: 'systemctl', args: ['restart', 'torrent-service'], cwd },
  ];
}

async function runUpdateProcess(target, steps) {
  startUpdate(target);

  for (const step of steps) {
    try {
      setCurrentStep(step.name);
      addLog(step.name, `Starting: ${step.command} ${step.args.join(' ')}`, 'info');

      await executeCommand(step.command, step.args, step.name, step.cwd);

      completeStep(step.name, true);
      addLog(step.name, `Completed successfully`, 'success');
    } catch (error) {
      completeStep(step.name, false, error.message);
      addLog(step.name, `Failed: ${error.message}`, 'error');
      finishUpdate(false, `Failed at step: ${step.name}`);
      logger.error(`Update failed at step ${step.name}`, { target, error: error.message });
      return;
    }
  }

  finishUpdate(true);
  logger.info('Update completed successfully', { target });
}

function executeCommand(command, args, stepName, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: cwd || process.cwd(),
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        addLog(stepName, text.trim(), 'log');
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        addLog(stepName, text.trim(), 'error');
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

export async function POST(req) {
  try {
    const { session, error } = await requireAuth();
    if (error) return error;

    let target = TARGETS.APP;
    try {
      const body = await req.json();
      if (body?.target) target = body.target;
    } catch {
      // No body — default to updating the main app.
    }

    if (!Object.values(TARGETS).includes(target)) {
      return NextResponse.json(
        { success: false, error: `Unknown update target: ${target}` },
        { status: 400 }
      );
    }

    // Progress lives in a single global status object, so a second run would
    // overwrite the first one's steps mid-flight.
    if (isUpdateRunning()) {
      return NextResponse.json(
        { success: false, error: 'An update is already running.' },
        { status: 409 }
      );
    }

    logger.info('Update requested', { target, userId: session.user.id, email: session.user.email });

    // Resolve the steps up front so a missing torrent-service checkout is
    // reported to the caller instead of vanishing into the background task.
    let steps;
    try {
      steps = target === TARGETS.TORRENT_SERVICE ? torrentServiceSteps() : appSteps();
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }

    // Start the update process in the background
    // Don't await it - let it run independently
    runUpdateProcess(target, steps).catch((error) => {
      logger.error('Unhandled update error', { target, error: error.message });
    });

    return NextResponse.json({
      success: true,
      target,
      message: `${TARGET_LABELS[target]} update started. Check WebSocket for status updates.`,
    });
  } catch (error) {
    logger.error('POST /api/system/run-update - Error', { error: error.message });
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
