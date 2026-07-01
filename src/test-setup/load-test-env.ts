/**
 * Runs in each Jest worker before integration specs (globalSetup env does not propagate).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { assertTestDatabaseUrl } from './assert-test-database';

dotenv.config({
  path: path.resolve(__dirname, '../../.env.test'),
  override: true,
});

process.env.NODE_ENV = 'test';
assertTestDatabaseUrl();

const dbName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, '');
console.log(`[integration] DATABASE_URL → ${dbName}`);
