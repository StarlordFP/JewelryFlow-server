import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IntegrityCheckService } from './integrity-check.service';
import { formatCheckLine, hasIntegrityIssues } from './integrity-check.runner';

@Injectable()
export class IntegrityCheckScheduler {
  private readonly logger = new Logger(IntegrityCheckScheduler.name);

  constructor(private readonly integrityService: IntegrityCheckService) {}

  /** Daily at 11:59 PM Nepal time — end of business day integrity sweep. */
  @Cron('0 59 23 * * *', { timeZone: 'Asia/Kathmandu', name: 'daily-integrity-check' })
  async runDailyIntegrityCheck() {
    this.logger.log('Starting daily data integrity check…');

    const results = await this.integrityService.runChecks();

    for (const result of results) {
      const line = formatCheckLine(result);
      if (result.severity === 'FAIL') {
        this.logger.error(line);
      } else if (result.severity === 'WARN') {
        this.logger.warn(line);
      } else {
        this.logger.log(line);
      }
    }

    const fails = results.filter((r) => r.severity === 'FAIL');
    if (fails.length > 0) {
      await this.integrityService.persistFailAlerts(results);
      this.logger.error(`Daily integrity check: ${fails.length} FAIL-level issue(s) detected`);
    } else if (hasIntegrityIssues(results)) {
      this.logger.warn('Daily integrity check completed with warnings');
    } else {
      this.logger.log('Daily integrity check passed — all checks OK');
    }
  }
}
