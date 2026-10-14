import { defineConfig } from '@playwright/test';

// e2e идёт в настоящем Edge (или Chrome: RS_E2E_CHANNEL=chrome) поверх собранного сайта (`vite build` + `vite preview`).
// Браузеры Playwright не скачиваются — берём установленный в системе.
const PORT = 4173;
export const BASE_URL = `http://localhost:${PORT}/`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 5 * 60_000,          // экспорт 15 с — ~30–60 с, два формата подряд
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    channel: process.env.RS_E2E_CHANNEL ?? 'msedge',
    headless: process.env.RS_E2E_HEADED !== '1',
    acceptDownloads: true,
    viewport: { width: 1400, height: 1000 },
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
