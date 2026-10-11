import { defineConfig } from 'vitest/config';
import vercel from './vercel.json' with { type: 'json' };

// `vite preview` serves the same security headers as production, so a header that breaks the
// game (the content security policy most of all) shows up locally rather than after a deploy.
const productionHeaders = Object.fromEntries(vercel.headers.flatMap((rule) => rule.headers.map((h) => [h.key, h.value])));

export default defineConfig({
  build: { target: 'es2022' },
  preview: { headers: productionHeaders },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'server/**/*.test.ts', 'api/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The DOM/WebGL layer is covered by the Playwright flow in e2e/.
      include: ['src/game/**', 'src/imagery/**', 'src/account/**', 'src/multiplayer/**', 'src/social/**', 'src/daily/**', 'src/ui/nav.ts', 'scripts/lib/**', 'server/**', 'api/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
