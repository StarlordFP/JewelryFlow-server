import {
  FenegosidaScrapeProvider,
  parseFenegosidaApiToday,
} from '../src/rates/providers/fenegosida-scrape.provider';

async function main() {
  const res = await fetch('https://api.fenegosida.org/api/website/v1/Dashboard/today', {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  const json = await res.json();
  console.log('api_status', res.status, 'rows', Array.isArray(json) ? json.length : typeof json);
  console.log('parsed', parseFenegosidaApiToday(json));

  const provider = new FenegosidaScrapeProvider();
  const fetched = await provider.fetchTodayRates();
  console.log('provider', fetched);
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
