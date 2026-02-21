/** @format */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Parse human-readable size strings to bytes
 * e.g., "100G" -> 100000000000, "1.5T" -> 1500000000000
 * @param {string} sizeStr - Size string (e.g., "100G", "1.5T")
 * @returns {number} Size in bytes
 */
function parseSize(sizeStr) {
  if (!sizeStr || sizeStr === '-') return 0;

  const units = {
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
  };

  const match = sizeStr.match(/^([\d.]+)([KMGTP]?)B?$/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2] || '';

  return Math.round(value * (units[unit] || 1));
}

/**
 * Format bytes to human-readable size string
 * e.g., 100000000000 -> "100 GB"
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, index);
  return `${size.toFixed(2)} ${units[index]}`;
}

/**
 * List all ZFS pools with their status and usage
 * @returns {Promise<Array>} Array of pool objects: { name, size, alloc, free, health, sizeBytes, allocBytes, freeBytes }
 */
export async function listPools() {
  try {
    const { stdout } = await execFileAsync('zpool', [
      'list',
      '-H', // No header
      '-p', // Parseable format (bytes instead of human-readable)
      '-o', 'name,size,alloc,free,health',
    ]);

    return stdout
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [name, size, alloc, free, health] = line.split('\t');
        const sizeBytes = parseInt(size, 10) || 0;
        const allocBytes = parseInt(alloc, 10) || 0;
        const freeBytes = parseInt(free, 10) || 0;

        return {
          name,
          size: formatBytes(sizeBytes),
          alloc: formatBytes(allocBytes),
          free: formatBytes(freeBytes),
          health: health || 'UNKNOWN',
          sizeBytes,
          allocBytes,
          freeBytes,
        };
      });
  } catch (error) {
    console.error('Error listing ZFS pools:', error);
    throw new Error(`Failed to list ZFS pools: ${error.message}`);
  }
}

/**
 * Get detailed status of a ZFS pool
 * @param {string} poolName - Name of the pool
 * @returns {Promise<string>} Raw zpool status output
 */
export async function getPoolStatus(poolName) {
  try {
    const { stdout } = await execFileAsync('zpool', ['status', poolName]);
    return stdout;
  } catch (error) {
    console.error(`Error getting pool status for ${poolName}:`, error);
    throw new Error(`Failed to get pool status: ${error.message}`);
  }
}

/**
 * Create a new ZFS pool
 * @param {string} name - Name of the new pool
 * @param {string} vdevType - Virtual device type: 'stripe', 'mirror', 'raidz', 'raidz2'
 * @param {Array<string>} devices - Device paths (e.g., ['/dev/sda', '/dev/sdb'])
 * @returns {Promise<void>}
 */
export async function createPool(name, vdevType, devices) {
  if (!name || !devices || devices.length === 0) {
    throw new Error('Pool name and devices are required');
  }

  if (!['stripe', 'mirror', 'raidz', 'raidz2'].includes(vdevType)) {
    throw new Error('Invalid vdev type. Must be: stripe, mirror, raidz, or raidz2');
  }

  // For stripe (single device or multiple without mirror/raid), don't include vdev type
  let args = ['create', name];

  if (vdevType !== 'stripe' || devices.length > 1) {
    args.push(vdevType);
  }

  args.push(...devices);

  try {
    await execFileAsync('zpool', args);
  } catch (error) {
    console.error(`Error creating ZFS pool ${name}:`, error);
    throw new Error(`Failed to create ZFS pool: ${error.message}`);
  }
}

/**
 * List all ZFS datasets in a pool
 * @param {string} poolName - Name of the ZFS pool
 * @returns {Promise<Array>} Array of dataset objects: { name, used, avail, refer, mountpoint, type }
 */
export async function listDatasets(poolName) {
  try {
    const { stdout } = await execFileAsync('zfs', [
      'list',
      '-H', // No header
      '-r', // Recursive
      '-p', // Parseable format (bytes)
      '-o', 'name,used,avail,refer,mountpoint,type',
      poolName,
    ]);

    return stdout
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [name, used, avail, refer, mountpoint, type] = line.split('\t');
        const usedBytes = parseInt(used, 10) || 0;
        const availBytes = parseInt(avail, 10) || 0;
        const referBytes = parseInt(refer, 10) || 0;

        return {
          name,
          used: formatBytes(usedBytes),
          avail: formatBytes(availBytes),
          refer: formatBytes(referBytes),
          mountpoint: mountpoint || '-',
          type: type || 'filesystem',
          usedBytes,
          availBytes,
          referBytes,
        };
      });
  } catch (error) {
    console.error(`Error listing datasets for ${poolName}:`, error);
    throw new Error(`Failed to list datasets: ${error.message}`);
  }
}

/**
 * List available block devices that can be used for pool creation
 * Filters out devices already in use by ZFS
 * @returns {Promise<Array>} Array of disk objects: { name, size, type, model }
 */
export async function listAvailableDisks() {
  try {
    // First get all block devices
    const { stdout: lsblkOutput } = await execFileAsync('lsblk', [
      '-d', // Device only (no partitions)
      '-n', // No header
      '-o', 'NAME,SIZE,TYPE,MODEL',
      '/dev',
    ]);

    // Get list of devices already in ZFS pools
    let usedDevices = new Set();
    try {
      const { stdout: zpoolOutput } = await execFileAsync('zpool', ['status', '-v']);
      // Extract device names from zpool status output
      const deviceMatches = zpoolOutput.match(/\/dev\/[^\s]+/g) || [];
      usedDevices = new Set(deviceMatches.map((d) => d.replace(/[0-9]+$/, ''))); // Remove partition numbers
    } catch {
      // If zpool status fails, proceed without filtering
    }

    const disks = lsblkOutput
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const parts = line.split(/\s+/);
        const name = parts[0];
        const size = parts.slice(1, -2).join(' '); // SIZE can have spaces
        const type = parts[parts.length - 2];
        const model = parts[parts.length - 1];

        return {
          name: `/dev/${name}`,
          size,
          type,
          model: model !== '-' ? model : '',
        };
      })
      .filter(
        (disk) =>
          disk.type === 'disk' && // Only block devices, not partitions
          !usedDevices.has(disk.name) && // Not already in a pool
          disk.name !== '/dev/loop' && // Skip loop devices
          disk.name !== '/dev/sr' // Skip CD-ROM devices
      );

    return disks;
  } catch (error) {
    console.error('Error listing available disks:', error);
    throw new Error(`Failed to list available disks: ${error.message}`);
  }
}

/**
 * Test ZFS availability
 * @returns {Promise<object>} Status object with available and reason properties
 */
export async function testZfsSetup() {
  const status = { available: false, reason: 'Unknown' };

  try {
    await execFileAsync('zpool', ['list', '-H']);
    status.available = true;
    status.reason = 'ZFS is available and configured';
  } catch (error) {
    status.reason = `ZFS not available: ${error.message}`;
  }

  return status;
}
