import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const url = new URL(process.env.DATABASE_URL!);
const dbName = url.pathname.slice(1);
const host = url.hostname;
const port = url.port || '5432';
const user = url.username;

const backupDir = process.env.BACKUP_DIR ?? path.resolve(__dirname, '../backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const filename = `jewelryflow-backup-${timestamp}.sql`;
const filepath = path.join(backupDir, filename);

console.log(`Backing up ${dbName} to ${filepath}...`);
execSync(
  `pg_dump -h ${host} -p ${port} -U ${user} -d ${dbName} -f "${filepath}" --no-password`,
  { env: { ...process.env, PGPASSWORD: url.password }, stdio: 'inherit' },
);
console.log(`Backup complete: ${filepath}`);

const backups = fs
  .readdirSync(backupDir)
  .filter((f) => f.startsWith('jewelryflow-backup-') && f.endsWith('.sql'))
  .sort();
if (backups.length > 30) {
  const toDelete = backups.slice(0, backups.length - 30);
  toDelete.forEach((f) => {
    fs.unlinkSync(path.join(backupDir, f));
    console.log(`Deleted old backup: ${f}`);
  });
}
