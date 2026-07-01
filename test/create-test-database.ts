/**
 * Creates jewelryflow_test if it does not exist (connects via postgres maintenance DB).
 * Run once: npm run db:test:create
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { Client } from 'pg';

config({ path: resolve(__dirname, '../.env.test'), override: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL missing in .env.test');
  }

  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName.includes('test')) {
    throw new Error(`Refusing to create non-test database: ${dbName}`);
  }

  parsed.pathname = '/postgres';
  const adminUrl = parsed.toString();

  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  const exists = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [dbName],
  );

  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database: ${dbName}`);
  } else {
    console.log(`Database already exists: ${dbName}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
