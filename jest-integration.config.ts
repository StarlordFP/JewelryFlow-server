import type { Config } from 'jest';

/**
 * Jest Configuration for Integration Tests
 *
 * This config is optimized for running end-to-end integration tests
 * that rely on a real database, real HTTP requests, and complete flows.
 *
 * Key settings:
 * - testTimeout: 30s per test (DB queries can be slow)
 * - maxWorkers: 1 (serial execution prevents DB conflicts)
 * - detectOpenHandles: true (catch unclosed connections)
 * - testRegex: integration.spec.ts files
 */

const config: Config = {
  displayName: 'integration',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',

  // ────────────────────────────────────────────────────────────────────────
  // TIMEOUT SETTINGS
  // ────────────────────────────────────────────────────────────────────────
  // Integration tests need more time for:
  // - DB queries (especially with many relationships)
  // - HTTP requests (network latency)
  // - Setup/teardown (creating test data, cleaning up)
  testTimeout: 30_000, // 30 seconds per test

  // ────────────────────────────────────────────────────────────────────────
  // WORKER SETTINGS
  // ────────────────────────────────────────────────────────────────────────
  // Serial execution (1 worker) prevents:
  // - Transaction conflicts
  // - Database lock timeouts
  // - Foreign key constraint errors
  // - Port conflicts (if tests use real HTTP)
  maxWorkers: 1,

  // ────────────────────────────────────────────────────────────────────────
  // MODULE RESOLUTION
  // ────────────────────────────────────────────────────────────────────────
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          // Ensure TypeScript strict mode is used
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
        },
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // COVERAGE
  // ────────────────────────────────────────────────────────────────────────
  collectCoverageFrom: [
    '**/*.(t|j)s',
    // Exclude test files, node_modules, dist
    '!**/*.spec.ts',
    '!**/*.integration.spec.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/coverage/**',
  ],
  coverageDirectory: '../coverage/integration',
  coverageReporters: ['text', 'lcov', 'json-summary'],

  // ────────────────────────────────────────────────────────────────────────
  // DEBUGGING
  // ────────────────────────────────────────────────────────────────────────
  // Detect unclosed handles (DB connections, HTTP servers, timers)
  // This catches memory leaks and resource leaks in tests
  detectOpenHandles: true,

  // Bail on first test failure for faster feedback during development
  bail: false,

  // ────────────────────────────────────────────────────────────────────────
  // VERBOSE OUTPUT
  // ────────────────────────────────────────────────────────────────────────
  verbose: true,

  // ────────────────────────────────────────────────────────────────────────
  // GLOBAL SETUP / TEARDOWN (OPTIONAL)
  // ────────────────────────────────────────────────────────────────────────
  // Uncomment if you need to set up/tear down shared resources before/after all tests
  // globalSetup: './src/common/test/global-setup.ts',
  // globalTeardown: './src/common/test/global-teardown.ts',

  // ────────────────────────────────────────────────────────────────────────
  // SETUP FILES (OPTIONAL)
  // ────────────────────────────────────────────────────────────────────────
  // Run before each test file (e.g., to load environment variables)
  // setupFilesAfterEnv: ['./src/common/test/setup.ts'],
};

export default config;
