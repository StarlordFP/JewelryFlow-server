/** Extract database name from a Postgres connection URL. */
export function getDatabaseName(url: string): string {
  try {
    return new URL(url).pathname.slice(1).split('?')[0];
  } catch {
    return url;
  }
}

export function isDevOrTestDatabase(url: string): boolean {
  const name = getDatabaseName(url).toLowerCase();
  return name.includes('_dev') || name.includes('local') || name.includes('test');
}

export function isTestDatabase(url: string): boolean {
  return getDatabaseName(url).toLowerCase().includes('test');
}

export function maskDatabaseUrl(url: string): string {
  return url.replace(/:\/\/.*@/, '://***@');
}
