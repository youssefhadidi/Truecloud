/** @format */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/authCheck';
import { spawn } from 'child_process';
import { logger } from '@/lib/logger';
import { STEPS, startUpdate, setCurrentStep, completeStep, addLog, finishUpdate } from '@/lib/updateStatus';

async function runUpdateProcess() {
  const updateStatus = startUpdate();
  const steps = [
    { name: STEPS.PULLING, command: 'bun', args: ['run', 'pull'] },
    { name: STEPS.INSTALLING, command: 'bun', args: ['install'] },
    { name: STEPS.REBUILDING, command: 'bash', args: ['-c', 'sed -i \'s|require("../../../build/Release/node_datachannel.node")|require(require("path").join(process.cwd(),"node_modules/node-datachannel/build/Release/node_datachannel.node"))|g\' node_modules/node-datachannel/dist/cjs/lib/node-datachannel.cjs'] },
    { name: STEPS.DB_PUSH, command: 'bun', args: ['run', 'db:push'] },
    { name: STEPS.BUILDING, command: 'bun', args: ['run', 'build'] },
    { name: STEPS.RESTARTING, command: 'bun', args: ['run', 'restart'] },
  ];

  for (const step of steps) {
    try {
      setCurrentStep(step.name);
      addLog(step.name, `Starting: ${step.command} ${step.args.join(' ')}`, 'info');

      await executeCommand(step.command, step.args, step.name);

      completeStep(step.name, true);
      addLog(step.name, `Completed successfully`, 'success');
    } catch (error) {
      completeStep(step.name, false, error.message);
      addLog(step.name, `Failed: ${error.message}`, 'error');
      finishUpdate(false, `Failed at step: ${step.name}`);
      logger.error(`Update failed at step ${step.name}`, { error: error.message });
      return;
    }
  }

  finishUpdate(true);
  logger.info('Update completed successfully');
}

function executeCommand(command, args, stepName) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
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

    logger.info('Update requested', { userId: session.user.id, email: session.user.email });

    // Start the update process in the background
    // Don't await it - let it run independently
    runUpdateProcess().catch((error) => {
      logger.error('Unhandled update error', { error: error.message });
    });

    return NextResponse.json({
      success: true,
      message: 'Update process started. Check WebSocket for status updates.',
    });
  } catch (error) {
    logger.error('POST /api/system/run-update - Error', { error: error.message });
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 },
    );
  }
}
