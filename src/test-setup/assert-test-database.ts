export function assertTestDatabaseUrl(url?: string): void {
  const dbUrl = url ?? process.env.DATABASE_URL ?? '';
  if (!dbUrl.includes('_test') && !dbUrl.includes('test')) {
    throw new Error(
      `REFUSING TO RUN TESTS: DATABASE_URL does not point to a test database.\n` +
        `Current URL: ${dbUrl}\n` +
        `Set up server/.env.test with a separate test database first.`,
    );
  }
}

export function assertIntegrationTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('_test') && !url.includes('test')) {
    throw new Error('Tests must not run against a non-test database.');
  }
}
