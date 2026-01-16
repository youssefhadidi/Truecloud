/** @format */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const secret = crypto.randomBytes(32).toString('base64');

console.log('\n=== Generated NextAuth Secret ===\n');
console.log(secret);
console.log('\n');

const envPath = path.join(__dirname, '..', '.env.local');

if (fs.existsSync(envPath)) {
  let envContent = fs.readFileSync(envPath, 'utf-8');

  if (envContent.includes('NEXTAUTH_SECRET=')) {
    envContent = envContent.replace(/NEXTAUTH_SECRET=.*/, `NEXTAUTH_SECRET="${secret}"`);
    fs.writeFileSync(envPath, envContent);
    console.log('✓ Updated NEXTAUTH_SECRET in .env.local\n');
  } else {
    console.log('⚠ NEXTAUTH_SECRET not found in .env.local');
    console.log('Add this line to your .env.local file:\n');
    console.log(`NEXTAUTH_SECRET="${secret}"\n`);
  }
} else {
  console.log('⚠ .env.local not found');
  console.log('Add this to your .env.local file:\n');
  console.log(`NEXTAUTH_SECRET="${secret}"\n`);
}
