import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  IntegrityCheckResult,
  runIntegrityChecks,
  fetchCurrentRowCounts,
  RowCountBaseline,
} from './integrity-check.runner';
import * as fs from 'fs';
import * as path from 'path';

const BASELINE_PATH = path.resolve(__dirname, '../../../data/integrity-baseline.json');

@Injectable()
export class IntegrityCheckService {
  private readonly logger = new Logger(IntegrityCheckService.name);

  constructor(private readonly prisma: PrismaService) {}

  private loadBaseline(): RowCountBaseline | undefined {
    if (!fs.existsSync(BASELINE_PATH)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as RowCountBaseline;
    } catch {
      this.logger.warn(`Could not parse baseline at ${BASELINE_PATH}`);
      return undefined;
    }
  }

  async runChecks(): Promise<IntegrityCheckResult[]> {
    const baseline = this.loadBaseline();
    return runIntegrityChecks(this.prisma, baseline);
  }

  async persistFailAlerts(results: IntegrityCheckResult[]): Promise<void> {
    const fails = results.filter((r) => r.severity === 'FAIL');
    for (const check of fails) {
      const existing = await this.prisma.integrityAlert.findFirst({
        where: {
          checkName: check.checkName,
          message: check.message,
          resolvedAt: null,
        },
      });
      if (!existing) {
        await this.prisma.integrityAlert.create({
          data: {
            checkName: check.checkName,
            severity: check.severity,
            message: check.message,
          },
        });
      }
    }
  }

  async listActiveAlerts() {
    return this.prisma.integrityAlert.findMany({
      where: { resolvedAt: null },
      orderBy: { detectedAt: 'desc' },
    });
  }

  async hasActiveAlerts(): Promise<boolean> {
    const count = await this.prisma.integrityAlert.count({ where: { resolvedAt: null } });
    return count > 0;
  }

  async updateBaseline(): Promise<Record<string, number>> {
    const counts = await fetchCurrentRowCounts(this.prisma);
    const dir = path.dirname(BASELINE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n');
    return counts;
  }
}
