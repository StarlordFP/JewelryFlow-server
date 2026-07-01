import * as dotenv from 'dotenv';
import * as path from 'path';
import { assertTestDatabaseUrl } from './assert-test-database';

export default async function globalSetup() {
  dotenv.config({
    path: path.resolve(__dirname, '../../.env.test'),
    override: true,
  });

  const url = process.env.DATABASE_URL ?? '';
  assertTestDatabaseUrl(url);

  const dbName = new URL(url).pathname.replace(/^\//, '');
  console.log(`[globalSetup] DATABASE_URL → ${dbName}`);
}
