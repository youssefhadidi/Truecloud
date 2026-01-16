/** @format */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const readline = require('readline');

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
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
      },
    });

    console.log('\n✓ Admin user created successfully!');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Username: ${user.username}`);
  } catch (error) {
    console.error('\n✗ Error creating user:', error.message);
  } finally {
    await prisma.$disconnect();
    rl.close();
  }
}

createAdminUser();
