import { execSync } from 'child_process';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const backupFile = process.argv[2];
if (!backupFile) {
  console.error('Usage: ts-node scripts/restore-db.ts <backup-file.sql>');
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL!);
const dbName = url.pathname.slice(1);
const host = url.hostname;
const port = url.port || '5432';
const user = url.username;

const resolved = path.isAbsolute(backupFile)
  ? backupFile
  : path.resolve(process.cwd(), backupFile);

console.log(`WARNING: This will overwrite ${dbName} with data from ${resolved}`);
console.log('Press Ctrl+C within 5 seconds to cancel...');
setTimeout(() => {
  execSync(
    `psql -h ${host} -p ${port} -U ${user} -d ${dbName} -f "${resolved}"`,
    { env: { ...process.env, PGPASSWORD: url.password }, stdio: 'inherit' },
  );
  console.log('Restore complete.');
}, 5000);
