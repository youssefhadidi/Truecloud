/** @format */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Format bytes to human-readable size string
 * e.g., 107374182400 -> "100.00 GB"
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
          name: name?.trim(),
          size: formatBytes(sizeBytes),
          alloc: formatBytes(allocBytes),
          free: formatBytes(freeBytes),
          // Fix #3: trim trailing newline from last field
          health: health?.trim() || 'UNKNOWN',
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
 * @param {boolean} force - Force creation, overwriting existing filesystems (default: false)
 * @param {string|null} mountpoint - Mount point for the pool (default: null, uses ZFS default)
 * @returns {Promise<void>}
 */
export async function createPool(name, vdevType, devices, force = false, mountpoint = null) {
  if (!name || !devices || devices.length === 0) {
    throw new Error('Pool name and devices are required');
  }

  if (!['stripe', 'mirror', 'raidz', 'raidz2'].includes(vdevType)) {
    throw new Error('Invalid vdev type. Must be: stripe, mirror, raidz, or raidz2');
  }

  // Fix #2: 'stripe' is not a ZFS vdev keyword — omit it; ZFS stripes by default
  // For mirror/raidz/raidz2, the keyword must precede the devices
  const args = ['create'];
  if (force) {
    args.push('-f');
  }
  if (mountpoint) {
    args.push('-m', mountpoint);
  }
  args.push(name);
  if (vdevType !== 'stripe') {
    args.push(vdevType);
  }
  args.push(...devices);

  try {
    await execFileAsync('zpool', args);
  } catch (error) {
    // Check if error is due to existing filesystem
    if (error.message.includes('contains a filesystem') && !force) {
      const err = new Error(
        `Devices contain existing filesystems. Confirm to overwrite and retry with force flag.`
      );
      err.code = 'EXISTING_FILESYSTEM';
      err.details = error.message;
      throw err;
    }
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
          name: name?.trim(),
          used: formatBytes(usedBytes),
          avail: formatBytes(availBytes),
          refer: formatBytes(referBytes),
          mountpoint: mountpoint?.trim() || '-',
          // Fix #4: trim trailing newline from last field
          type: type?.trim() || 'filesystem',
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
 * List available block devices that can be used for pool creation.
 * Uses lsblk JSON output for reliable parsing (MODEL can contain spaces).
 * @returns {Promise<Array>} Array of disk objects: { name, size, type, model }
 */
export async function listAvailableDisks() {
  try {
    // Fix #5: removed '/dev' path argument — lsblk lists all devices without a path
    // Fix #6: use -J (JSON) for reliable parsing when MODEL contains spaces
    const { stdout: lsblkOutput } = await execFileAsync('lsblk', [
      '-d', // Devices only (no partitions)
      '-J', // JSON output
      '-o', 'NAME,SIZE,TYPE,MODEL',
    ]);

    const parsed = JSON.parse(lsblkOutput);
    const allDevices = parsed.blockdevices || [];

    // Get list of devices already in ZFS pools to filter them out
    let usedDevices = new Set();
    try {
      const { stdout: zpoolOutput } = await execFileAsync('zpool', ['status', '-v']);
      const deviceMatches = zpoolOutput.match(/\/dev\/[^\s]+/g) || [];
      usedDevices = new Set(deviceMatches);
    } catch {
      // If no pools exist yet, proceed without filtering
    }

    // Fix #7: filter by type === 'disk' is sufficient — loop (type='loop') and
    // CD-ROMs (type='rom') are already excluded; removed the broken name-prefix checks
    return allDevices
      .filter((dev) => dev.type === 'disk' && !usedDevices.has(`/dev/${dev.name}`))
      .map((dev) => ({
        name: `/dev/${dev.name}`,
        size: dev.size || '',
        type: dev.type,
        model: dev.model || '',
      }));
  } catch (error) {
    console.error('Error listing available disks:', error);
    throw new Error(`Failed to list available disks: ${error.message}`);
  }
}

/**
 * Add a cache (L2ARC) device to an existing ZFS pool
 * @param {string} poolName - Name of the pool
 * @param {string} device - Device path (e.g., '/dev/sdc')
 * @returns {Promise<void>}
 */
export async function addCacheDevice(poolName, device) {
  if (!poolName || !device) {
    throw new Error('Pool name and device are required');
  }
  try {
    await execFileAsync('zpool', ['add', poolName, 'cache', device]);
  } catch (error) {
    throw new Error(`Failed to add cache device: ${error.message}`);
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
