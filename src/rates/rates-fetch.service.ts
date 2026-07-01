import { Injectable } from '@nestjs/common';
import { FetchedRateSnapshotStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { FenegosidaScrapeProvider } from './providers/fenegosida-scrape.provider';
import { RATE_SOURCE_FENEGOSIDA } from './providers/rate-source.provider';
import { RATE_SWING_THRESHOLD_PCT } from './rates.constants';

@Injectable()
export class RatesFetchService {
  private readonly provider = new FenegosidaScrapeProvider();

  constructor(private readonly prisma: PrismaService) {}

  async getLatestSnapshot() {
    // Prefer an unconsumed fetch so the banner reappears after a new manual/cron fetch.
    const actionable = await this.prisma.fetchedRateSnapshot.findFirst({
      where: {
        status: {
          in: [FetchedRateSnapshotStatus.PENDING, FetchedRateSnapshotStatus.SUSPICIOUS],
        },
      },
      orderBy: { fetchedAt: 'desc' },
    });
    if (actionable) return this.formatSnapshot(actionable);

    const snapshot = await this.prisma.fetchedRateSnapshot.findFirst({
      orderBy: { fetchedAt: 'desc' },
    });
    return snapshot ? this.formatSnapshot(snapshot) : null;
  }

  async runFetch(manual = false) {
    if (!manual && this.isSaturdayKathmandu()) {
      return this.getLatestSnapshot();
    }

    const fetched = await this.provider.fetchTodayRates();
    const lastSnapshot = await this.prisma.fetchedRateSnapshot.findFirst({
      orderBy: { fetchedAt: 'desc' },
    });

    if (
      !manual &&
      fetched.nepaliDateLabel &&
      lastSnapshot?.nepaliDateLabel === fetched.nepaliDateLabel &&
      lastSnapshot.status !== FetchedRateSnapshotStatus.FAILED
    ) {
      return this.formatSnapshot(lastSnapshot);
    }

    const { status, warningReason } = await this.evaluateStatus(fetched);

    const snapshot = await this.prisma.fetchedRateSnapshot.create({
      data: {
        source: RATE_SOURCE_FENEGOSIDA,
        nepaliDateLabel: fetched.nepaliDateLabel,
        fineGoldPer10g:
          fetched.fineGoldPer10g != null
            ? new Decimal(fetched.fineGoldPer10g.toFixed(2))
            : null,
        silverPer10g:
          fetched.silverPer10g != null
            ? new Decimal(fetched.silverPer10g.toFixed(2))
            : null,
        status,
        warningReason,
        rawSnippet: fetched.rawSnippet?.slice(0, 2000) ?? null,
      },
    });

    return this.formatSnapshot(snapshot);
  }

  /** Exposed for unit tests — evaluates swing vs current DailyRates. */
  async evaluateStatus(fetched: {
    fineGoldPer10g: number | null;
    silverPer10g: number | null;
  }): Promise<{ status: FetchedRateSnapshotStatus; warningReason: string | null }> {
    if (fetched.fineGoldPer10g == null && fetched.silverPer10g == null) {
      return {
        status: FetchedRateSnapshotStatus.FAILED,
        warningReason: 'Could not parse gold or silver rates from source page',
      };
    }

    const warnings: string[] = [];
    const metals = await this.prisma.metalType.findMany({ where: { isActive: true } });
    const gold24k = metals.find(
      (m) => m.name.toLowerCase().includes('gold') && m.name.toLowerCase().includes('24k'),
    );
    const silver = metals.find((m) => m.name.toLowerCase().includes('silver'));

    if (fetched.fineGoldPer10g != null && gold24k) {
      const fetchedPerGram = fetched.fineGoldPer10g / 10;
      const current = await this.prisma.dailyRate.findFirst({
        where: { metalTypeId: gold24k.id, isCurrent: true },
      });
      if (current) {
        const currentSell = Number(current.sellRatePerGram);
        if (currentSell > 0 && this.swingPct(fetchedPerGram, currentSell) > RATE_SWING_THRESHOLD_PCT) {
          warnings.push(
            `24K gold fetched rate (${fetchedPerGram.toFixed(2)}/g) differs by more than ${RATE_SWING_THRESHOLD_PCT}% from current (${currentSell.toFixed(2)}/g)`,
          );
        }
      }
    }

    if (fetched.silverPer10g != null && silver) {
      const fetchedPerGram = fetched.silverPer10g / 10;
      const current = await this.prisma.dailyRate.findFirst({
        where: { metalTypeId: silver.id, isCurrent: true },
      });
      if (current) {
        const currentSell = Number(current.sellRatePerGram);
        if (currentSell > 0 && this.swingPct(fetchedPerGram, currentSell) > RATE_SWING_THRESHOLD_PCT) {
          warnings.push(
            `Pure silver fetched rate (${fetchedPerGram.toFixed(2)}/g) differs by more than ${RATE_SWING_THRESHOLD_PCT}% from current (${currentSell.toFixed(2)}/g)`,
          );
        }
      }
    }

    if (warnings.length > 0) {
      return {
        status: FetchedRateSnapshotStatus.SUSPICIOUS,
        warningReason: warnings.join('; '),
      };
    }

    return { status: FetchedRateSnapshotStatus.PENDING, warningReason: null };
  }

  private swingPct(newVal: number, oldVal: number): number {
    return (Math.abs(newVal - oldVal) / oldVal) * 100;
  }

  isSaturdayKathmandu(): boolean {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kathmandu',
      weekday: 'short',
    }).format(new Date());
    return weekday === 'Sat';
  }

  private formatSnapshot(snapshot: {
    id: string;
    fetchedAt: Date;
    source: string;
    nepaliDateLabel: string | null;
    fineGoldPer10g: Decimal | null;
    silverPer10g: Decimal | null;
    status: FetchedRateSnapshotStatus;
    warningReason: string | null;
    rawSnippet: string | null;
    consumedAt: Date | null;
    consumedByDailyRateIds: string[];
  }) {
    const toNum = (v: Decimal | null) => (v != null ? v.toFixed(2) : null);
    return {
      id: snapshot.id,
      fetchedAt: snapshot.fetchedAt,
      source: snapshot.source,
      nepaliDateLabel: snapshot.nepaliDateLabel,
      fineGoldPer10g: toNum(snapshot.fineGoldPer10g),
      silverPer10g: toNum(snapshot.silverPer10g),
      fineGoldSellPerGram:
        snapshot.fineGoldPer10g != null
          ? snapshot.fineGoldPer10g.div(10).toFixed(2)
          : null,
      pureSilverSellPerGram:
        snapshot.silverPer10g != null
          ? snapshot.silverPer10g.div(10).toFixed(2)
          : null,
      status: snapshot.status,
      warningReason: snapshot.warningReason,
      rawSnippet: snapshot.rawSnippet,
      consumedAt: snapshot.consumedAt,
      consumedByDailyRateIds: snapshot.consumedByDailyRateIds,
    };
  }
}
