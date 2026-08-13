import { execSync } from 'child_process';
import * as readline from 'readline';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { isTestDatabase, maskDatabaseUrl } from '../src/common/integrity/database-url.util';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const CONFIRM_PHRASE = 'YES I WANT TO WIPE THE DATABASE';
const dbUrl = process.env.DATABASE_URL ?? '';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  if (!isTestDatabase(dbUrl)) {
    console.error('❌ RESET BLOCKED: DATABASE_URL must point to a test database (name contains "test").');
    console.error('   URL:', maskDatabaseUrl(dbUrl));
    console.error('   This script only allows wiping jewelryflow_test — never dev or production.');
    process.exit(1);
  }

  console.log('⚠️  DATABASE WIPE — migrate reset');
  console.log('   Target:', maskDatabaseUrl(dbUrl));
  console.log('');
  console.log('This will DELETE ALL DATA and re-apply migrations.');
  console.log('Press Ctrl+C within 10 seconds to cancel…');

  for (let i = 10; i >= 1; i--) {
    process.stdout.write(`\rProceeding in ${i}s… `);
    await sleep(1000);
  }
  console.log('\n');

  const typed = await ask(`Type "${CONFIRM_PHRASE}" to continue: `);
  if (typed !== CONFIRM_PHRASE) {
    console.error('❌ Confirmation phrase did not match. Aborting.');
    process.exit(1);
  }

  console.log('Running prisma migrate reset…');
  execSync('npx prisma migrate reset --force', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
