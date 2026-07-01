import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RatesFetchService } from './rates-fetch.service';

@Injectable()
export class RatesFetchScheduler {
  constructor(private readonly fetchService: RatesFetchService) {}

  /** 11:30 AM Asia/Kathmandu, Sunday–Friday (excludes Saturday). */
  @Cron('0 30 11 * * 0-5', { timeZone: 'Asia/Kathmandu' })
  async handleScheduledFetch() {
    await this.fetchService.runFetch(false);
  }
}
