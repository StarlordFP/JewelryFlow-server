import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  runIntegrityChecks,
  formatCheckLine,
  hasIntegrityIssues,
  fetchCurrentRowCounts,
  RowCountBaseline,
} from '../src/common/integrity/integrity-check.runner';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const BASELINE_PATH = path.resolve(__dirname, '../data/integrity-baseline.json');
const updateBaseline = process.argv.includes('--update-baseline');

function loadBaseline(): RowCountBaseline | undefined {
  if (!fs.existsSync(BASELINE_PATH)) return undefined;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as RowCountBaseline;
}

function saveBaseline(counts: Record<string, number>) {
  const dir = path.dirname(BASELINE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n');
  console.log(`\nBaseline updated: ${BASELINE_PATH}`);
}

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('JewelryFlow Data Integrity Check');
    console.log('================================\n');

    const baseline = loadBaseline();
    const results = await runIntegrityChecks(prisma, baseline);

    for (const result of results) {
      console.log(formatCheckLine(result));
    }

    const issueCount = results.filter((r) => r.severity !== 'PASS').length;
    console.log('\n================================');
    if (hasIntegrityIssues(results)) {
      console.log(`Result: ${issueCount} issue(s) found`);
    } else {
      console.log('Result: All checks passed');
    }

    if (updateBaseline) {
      const counts = await fetchCurrentRowCounts(prisma);
      saveBaseline(counts);
    }

    if (hasIntegrityIssues(results)) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Integrity check failed to run:', err);
  process.exit(1);
});
