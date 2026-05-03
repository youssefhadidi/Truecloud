/** @format */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile } from 'fs/promises';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const SAMBA_CONF_PATH = '/etc/samba/smb.conf';

/**
 * Generate complete smb.conf content from shares array
 * @param {Array} shares - Array of SmbShare objects from database
 * @param {string} uploadDir - Path to uploads directory
 * @returns {string} Complete smb.conf content
 */
export function generateSmbConf(shares, uploadDir) {
  const globalSection = `[global]
   workgroup = WORKGROUP
   server string = TrueCloud Server
   security = user
   map to guest = bad user
   encrypt passwords = yes
   passdb backend = smbpasswd
   smb passwd file = /etc/samba/smbpasswd

`;

  const sharesSections = shares
    .map((share) => {
      const sharePath = share.path ? `${uploadDir}/${share.path}` : uploadDir;
      let section = `[${share.name}]\n`;
      if (share.comment) {
        section += `   comment = ${share.comment}\n`;
      }
      section += `   path = ${sharePath}\n`;
      section += `   browsable = ${share.browsable ? 'yes' : 'no'}\n`;
      section += `   read only = ${share.readOnly ? 'yes' : 'no'}\n`;
      section += `   guest ok = ${share.guestOk ? 'yes' : 'no'}\n`;

      const validUsers = JSON.parse(share.validUsers || '[]');
      if (validUsers.length > 0) {
        section += `   valid users = ${validUsers.join(',')}\n`;
      }

      section += `   create mask = 0664\n`;
      section += `   directory mask = 0775\n`;

      return section;
    })
    .join('\n');

  return globalSection + sharesSections;
}

/**
 * Write smb.conf to disk.
 * The app runs as root so we write directly via fs.writeFile.
 * @param {string} content - Complete smb.conf content
 * @returns {Promise<void>}
 */
export async function writeSmbConf(content) {
  await writeFile(SAMBA_CONF_PATH, content, { encoding: 'utf8' });
}

/**
 * Reload Samba configuration without restarting the service.
 * On Debian/Ubuntu the daemon is smbd; smbcontrol is tried first,
 * then systemctl reload smbd as fallback.
 * @returns {Promise<void>}
 */
export async function reloadSamba() {
  try {
    await execFileAsync('smbcontrol', ['smbd', 'reload-config']);
  } catch {
    try {
      await execFileAsync('systemctl', ['reload', 'smbd']);
    } catch (fallbackError) {
      console.error('Error reloading Samba:', fallbackError);
      throw new Error(`Failed to reload Samba: ${fallbackError.message}`);
    }
  }
}

const SMB_GROUP = process.env.SMB_GROUP || 'truecloud';

/**
 * Ensure the shared SMB group exists. Idempotent — ignores "already exists".
 */
async function ensureSmbGroup() {
  try {
    await execFileAsync('groupadd', ['--system', SMB_GROUP]);
  } catch (error) {
    // exit code 9 means group already exists — that's fine
    if (!error.message.includes('already exists') && error.code !== 9) {
      throw error;
    }
  }
}

/**
 * Ensure a Linux system user exists (required by smbpasswd).
 * Creates a no-login, no-home system user in the shared SMB group if they don't already exist.
 * @param {string} username
 */
async function ensureSystemUser(username) {
  await ensureSmbGroup();
  try {
    await execFileAsync('id', [username]);
    // User exists — ensure they're in the shared group
    await execFileAsync('usermod', ['--gid', SMB_GROUP, username]);
  } catch {
    await execFileAsync('useradd', [
      '--no-create-home',
      '--shell', '/usr/sbin/nologin',
      '--system',
      '--gid', SMB_GROUP,
      username,
    ]);
  }
}

/**
 * Add or update a user in Samba password database.
 * Automatically creates the Linux system user if needed.
 * Uses spawn with piped stdin (no shell) to avoid command injection.
 * @param {string} username - Username to add/update
 * @param {string} password - Password to set
 * @returns {Promise<void>}
 */
export async function addOrUpdateSmbUser(username, password) {
  // Samba requires the user to exist as a Linux system user
  await ensureSystemUser(username);

  const input = `${password}\n${password}\n`;

  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn('smbpasswd', ['-s', '-a', username], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`smbpasswd exited with code ${code}: ${stderr}`));
      } else {
        resolve();
      }
    });

    proc.on('error', reject);
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

/**
 * Delete a user from Samba password database and remove the Linux system user.
 * @param {string} username - Username to delete
 * @returns {Promise<void>}
 */
export async function deleteSmbUser(username) {
  // Remove from Samba (ignore if not found)
  try {
    await execFileAsync('smbpasswd', ['-x', username]);
  } catch (error) {
    if (!error.message.includes('does not exist') && !error.message.includes('Failed to find entry')) {
      console.warn(`Warning removing SMB entry for ${username}:`, error.message);
    }
  }

  // Remove the Linux system user (ignore if not found)
  try {
    await execFileAsync('userdel', [username]);
  } catch (error) {
    if (!error.message.includes('does not exist') && !error.stderr?.includes('does not exist')) {
      console.warn(`Warning removing system user ${username}:`, error.message);
    }
  }
}

/**
 * Test Samba availability
 * @returns {Promise<object>} Status object with available and reason properties
 */
export async function testSambaSetup() {
  const status = { available: false, reason: 'Unknown' };

  try {
    const { stdout } = await execAsync('systemctl is-active smbd 2>/dev/null || echo inactive');
    if (stdout.trim() !== 'active') {
      status.reason = 'Samba service (smbd) is not running';
      return status;
    }
    status.available = true;
    status.reason = 'Samba is available and configured';
  } catch (error) {
    status.reason = `Error testing Samba: ${error.message}`;
  }

  return status;
}
