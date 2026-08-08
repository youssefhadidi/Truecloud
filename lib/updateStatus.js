/**
 * Update Status Tracking
 * Manages update process status and broadcasts to WebSocket clients
 */

const STEPS = {
  PULLING: 'pull',
  INSTALLING: 'install',
  REBUILDING: 'rebuild',
  DB_MIGRATE: 'db_migrate',
  DB_GENERATE: 'db_generate',
  BUILDING: 'build',
  RESTARTING: 'restart',
};

const STEP_LABELS = {
  [STEPS.PULLING]: 'Pulling latest code',
  [STEPS.INSTALLING]: 'Installing dependencies',
  [STEPS.REBUILDING]: 'Rebuilding native modules',
  [STEPS.DB_MIGRATE]: 'Running database migrations',
  [STEPS.DB_GENERATE]: 'Generating Prisma client',
  [STEPS.BUILDING]: 'Building application',
  [STEPS.RESTARTING]: 'Restarting service',
};

// Update targets. Each one is a separate git checkout with its own step list,
// but they share this single status object — only one may run at a time.
const TARGETS = {
  APP: 'app',
  TORRENT_SERVICE: 'torrent-service',
};

const TARGET_LABELS = {
  [TARGETS.APP]: 'Truecloud',
  [TARGETS.TORRENT_SERVICE]: 'Torrent service',
};

const APP_STEPS = Object.values(STEPS).map(name => ({ name, label: STEP_LABELS[name] }));

// torrent-service runs on Node with its own package manager: no build, no
// Prisma, but it does need its native WebTorrent addon rebuilt after install.
const TORRENT_SERVICE_STEPS = [
  { name: STEPS.PULLING, label: 'Pulling torrent-service code' },
  { name: STEPS.INSTALLING, label: 'Installing torrent-service dependencies' },
  { name: STEPS.REBUILDING, label: 'Rebuilding native torrent modules' },
  { name: STEPS.RESTARTING, label: 'Restarting torrent-service' },
];

function stepsForTarget(target) {
  return target === TARGETS.TORRENT_SERVICE ? TORRENT_SERVICE_STEPS : APP_STEPS;
}

function initializeUpdateStatus(target = TARGETS.APP) {
  return {
    isRunning: false,
    target,
    targetLabel: TARGET_LABELS[target] || target,
    currentStep: null,
    steps: stepsForTarget(target).map(step => ({
      name: step.name,
      label: step.label,
      status: 'pending', // pending, running, completed, failed
      startTime: null,
      endTime: null,
      logs: [],
    })),
    startTime: null,
    endTime: null,
    success: null,
    error: null,
    logs: [],
  };
}

function isUpdateRunning() {
  return Boolean(global.updateStatus?.isRunning);
}

function startUpdate(target = TARGETS.APP) {
  const status = initializeUpdateStatus(target);
  status.isRunning = true;
  status.startTime = new Date();
  global.updateStatus = status;
  broadcastStatus();
  return status;
}

function setCurrentStep(stepName) {
  if (!global.updateStatus) return;

  const step = global.updateStatus.steps.find(s => s.name === stepName);
  if (step) {
    step.status = 'running';
    step.startTime = new Date();
    global.updateStatus.currentStep = stepName;
    broadcastStatus();
  }
}

function completeStep(stepName, success = true, error = null) {
  if (!global.updateStatus) return;

  const step = global.updateStatus.steps.find(s => s.name === stepName);
  if (step) {
    step.status = success ? 'completed' : 'failed';
    step.endTime = new Date();
    if (error) {
      step.logs.push({ type: 'error', message: error, timestamp: new Date() });
    }
    broadcastStatus();
  }
}

function addLog(stepName, message, type = 'log') {
  if (!global.updateStatus) return;

  const log = {
    type,
    message,
    timestamp: new Date(),
  };

  global.updateStatus.logs.push(log);

  const step = global.updateStatus.steps.find(s => s.name === stepName);
  if (step) {
    step.logs.push(log);
  }

  broadcastStatus();
}

function finishUpdate(success = true, error = null) {
  if (!global.updateStatus) return;

  global.updateStatus.isRunning = false;
  global.updateStatus.endTime = new Date();
  global.updateStatus.success = success;
  if (error) {
    global.updateStatus.error = error;
  }
  broadcastStatus();
}

function broadcastStatus() {
  if (global.broadcastUpdate && global.updateStatus) {
    global.broadcastUpdate({
      type: 'status',
      payload: global.updateStatus,
    });
  }
}

function getStatus() {
  return global.updateStatus || initializeUpdateStatus();
}

export {
  STEPS,
  STEP_LABELS,
  TARGETS,
  TARGET_LABELS,
  initializeUpdateStatus,
  isUpdateRunning,
  startUpdate,
  setCurrentStep,
  completeStep,
  addLog,
  finishUpdate,
  getStatus,
  broadcastStatus,
};
