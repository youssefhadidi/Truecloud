/** @format */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Run a systemctl action on a service.
 * @param {'start'|'stop'|'enable'|'disable'} action
 * @param {string} service - e.g. 'smbd', 'zfs-zed'
 */
async function systemctl(action, service) {
  await execFileAsync('systemctl', [action, service]);
}

/**
 * Enable and start a systemd service.
 * @param {string} service
 */
export async function enableService(service) {
  await systemctl('enable', service);
  await systemctl('start', service);
}

/**
 * Stop and disable a systemd service.
 * @param {string} service
 */
export async function disableService(service) {
  await systemctl('stop', service);
  await systemctl('disable', service);
}

/**
 * Whether a service is currently running.
 * @param {string} service
 * @returns {Promise<boolean>} false if the unit is unknown or systemctl is unavailable
 */
export async function isServiceActive(service) {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', service]);
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

/**
 * Whether a service is enabled at boot.
 * @param {string} service
 * @returns {Promise<boolean>} false if the unit is unknown or systemctl is unavailable
 */
export async function isServiceEnabled(service) {
  try {
    const { stdout } = await execFileAsync('systemctl', ['is-enabled', service]);
    return stdout.trim() === 'enabled';
  } catch {
    return false;
  }
}
