/** @format */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const readline = require('readline');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

const SMB_GROUP = process.env.SMB_GROUP || 'truecloud';

async function ensureSmbGroup() {
  try {
    await execFileAsync('groupadd', ['--system', SMB_GROUP]);
  } catch (error) {
    if (!error.message.includes('already exists') && error.code !== 9) {
      throw error;
    }
  }
}

async function ensureSystemUser(username) {
  await ensureSmbGroup();
  try {
    await execFileAsync('id', [username]);
    await execFileAsync('usermod', ['--gid', SMB_GROUP, username]);
    console.log(`  (Linux user '${username}' already exists, group updated)`);
  } catch {
    await execFileAsync('useradd', [
      '--no-create-home',
      '--shell', '/usr/sbin/nologin',
      '--system',
      '--gid', SMB_GROUP,
      username,
    ]);
    console.log(`  ✓ Linux system user '${username}' created`);
  }
}

async function addSmbUser(username, password) {
  await ensureSystemUser(username);

  await new Promise((resolve, reject) => {
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
    proc.stdin.write(`${password}\n${password}\n`);
    proc.stdin.end();
  });

  console.log(`  ✓ Samba user '${username}' registered`);
}

async function createAdminUser() {
  console.log('\n=== Create Admin User ===\n');

  const email = await question('Email: ');
  const username = await question('Username: ');
  const password = await question('Password: ');
  const name = await question('Full Name (optional): ');

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        name: name || username,
        role: 'admin',
        hasRootAccess: true,
      },
    });

    console.log('\n✓ Admin user created successfully!');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Username: ${user.username}`);

    console.log('\nSetting up system user for SMB access...');
    try {
      await addSmbUser(username, password);
    } catch (sambaError) {
      console.warn(`  ⚠ SMB setup failed: ${sambaError.message}`);
      console.warn('  Run manually: sudo smbpasswd -a ' + username);
    }
  } catch (error) {
    console.error('\n✗ Error creating user:', error.message);
  } finally {
    await prisma.$disconnect();
    rl.close();
  }
}

createAdminUser();
