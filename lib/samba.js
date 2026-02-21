/** @format */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

      if (share.guestOk) {
        section += `   guest ok = yes\n`;
      } else {
        section += `   guest ok = no\n`;
      }

      // Parse valid users from JSON string
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
 * Write smb.conf to disk using sudo
 * Requires the Node.js user to have passwordless sudo access to tee /etc/samba/smb.conf
 * @param {string} content - Complete smb.conf content
 * @returns {Promise<void>}
 */
export async function writeSmbConf(content) {
  try {
    // Use sudo tee to write the file with proper permissions
    const { stderr } = await execAsync(
      `echo "${content.replace(/"/g, '\\"')}" | sudo tee ${SAMBA_CONF_PATH} > /dev/null`,
      { shell: '/bin/bash' },
    );

    if (stderr && !stderr.includes('sudo')) {
      console.warn('Warning writing smb.conf:', stderr);
    }
  } catch (error) {
    console.error('Error writing smbConf:', error);
    throw new Error(`Failed to write smb.conf: ${error.message}`);
  }
}

/**
 * Reload Samba configuration without restarting the service
 * Requires passwordless sudo access to smbcontrol
 * @returns {Promise<void>}
 */
export async function reloadSamba() {
  try {
    await execAsync('sudo smbcontrol smbd reload-config', { shell: '/bin/bash' });
  } catch (error) {
    // smbcontrol might not be available in all setups, try systemctl fallback
    try {
      await execAsync('sudo systemctl reload smb', { shell: '/bin/bash' });
    } catch (fallbackError) {
      console.error('Error reloading Samba:', fallbackError);
      throw new Error(`Failed to reload Samba: ${error.message}`);
    }
  }
}

/**
 * Add or update a user in Samba password database
 * Requires the Node.js user to have passwordless sudo access to smbpasswd
 * @param {string} username - Username to add/update
 * @param {string} password - Password to set
 * @returns {Promise<void>}
 */
export async function addOrUpdateSmbUser(username, password) {
  try {
    // Using printf to avoid shell special characters issues
    const { stderr } = await execAsync(
      `printf '%s\\n%s\\n' "${password.replace(/"/g, '\\"')}" "${password.replace(/"/g, '\\"')}" | sudo smbpasswd -s -a ${username}`,
      { shell: '/bin/bash' },
    );

    // smbpasswd outputs to stderr even on success, only log actual errors
    if (stderr && !stderr.includes('Added user') && !stderr.includes('Updated password')) {
      console.warn(`Warning adding SMB user ${username}:`, stderr);
    }
  } catch (error) {
    console.error(`Error adding SMB user ${username}:`, error);
    throw new Error(`Failed to add SMB user ${username}: ${error.message}`);
  }
}

/**
 * Delete a user from Samba password database
 * Requires the Node.js user to have passwordless sudo access to smbpasswd
 * @param {string} username - Username to delete
 * @returns {Promise<void>}
 */
export async function deleteSmbUser(username) {
  try {
    await execAsync(`sudo smbpasswd -x ${username}`, { shell: '/bin/bash' });
  } catch (error) {
    // User might not exist in Samba, which is fine
    if (!error.message.includes('does not exist')) {
      console.error(`Error deleting SMB user ${username}:`, error);
      throw new Error(`Failed to delete SMB user ${username}: ${error.message}`);
    }
  }
}

/**
 * Test Samba connectivity and permissions
 * @returns {Promise<object>} Status object with available, reason, and sudoAccess properties
 */
export async function testSambaSetup() {
  const status = {
    available: false,
    reason: 'Unknown',
    sudoAccess: false,
  };

  try {
    // Check if smbd is running
    const { stdout } = await execAsync('systemctl is-active smbd 2>/dev/null || echo inactive', {
      shell: '/bin/bash',
    });

    if (stdout.trim() === 'inactive') {
      status.reason = 'Samba service (smbd) is not running';
      return status;
    }

    // Check sudo access
    try {
      await execAsync('sudo -n true', { shell: '/bin/bash' });
      status.sudoAccess = true;
    } catch {
      status.reason = 'No passwordless sudo access';
      return status;
    }

    status.available = true;
    status.reason = 'Samba is available and configured';
    return status;
  } catch (error) {
    status.reason = `Error testing Samba: ${error.message}`;
    return status;
  }
}
