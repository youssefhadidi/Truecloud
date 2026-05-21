/**
 * Update Status Tracking
 * Manages update process status and broadcasts to WebSocket clients
 */

const STEPS = {
  PULLING: 'pull',
  INSTALLING: 'install',
  REBUILDING: 'rebuild',
  DB_MIGRATE: 'db_migrate',
  BUILDING: 'build',
  RESTARTING: 'restart',
};

const STEP_LABELS = {
  [STEPS.PULLING]: 'Pulling latest code',
  [STEPS.INSTALLING]: 'Installing dependencies',
  [STEPS.REBUILDING]: 'Rebuilding native modules',
  [STEPS.DB_MIGRATE]: 'Running database migrations',
  [STEPS.BUILDING]: 'Building application',
  [STEPS.RESTARTING]: 'Restarting service',
};

function initializeUpdateStatus() {
  return {
    isRunning: false,
    currentStep: null,
    steps: Object.values(STEPS).map(step => ({
      name: step,
      label: STEP_LABELS[step],
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

function startUpdate() {
  const status = initializeUpdateStatus();
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

  if (success && typeof global.broadcastAppUpdated === 'function') {
    global.broadcastAppUpdated();
  }
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
  initializeUpdateStatus,
  startUpdate,
  setCurrentStep,
  completeStep,
  addLog,
  finishUpdate,
  getStatus,
  broadcastStatus,
};
