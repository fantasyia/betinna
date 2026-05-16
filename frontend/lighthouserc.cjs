/**
 * Lighthouse CI config — Betinna.ai frontend (Sprint 5 FIX 4).
 *
 * Performance budgets enforced em CI:
 *   - Performance score > 85
 *   - Accessibility > 90
 *   - Best practices > 90
 *   - FCP < 2000ms
 *   - LCP < 3000ms
 *   - TBT < 300ms
 *   - CLS < 0.1
 *
 * Em CI (GitHub Actions): `npx lhci autorun --config=./lighthouserc.cjs`
 * Em local: `npm install -D @lhci/cli && npx lhci autorun`
 */

module.exports = {
  ci: {
    collect: {
      // Serve dist/ em port 4174 e roda Lighthouse contra ela
      staticDistDir: './dist',
      // 3 corridas para estatística — pega a mediana
      numberOfRuns: 3,
      settings: {
        // Desktop preset — match com user-base B2B (uso predominante web)
        preset: 'desktop',
        // Throttling realista pra prod (não usa simulated CPU/network)
        throttlingMethod: 'devtools',
      },
    },
    assert: {
      assertions: {
        // ─── Scores (0-1 escala no Lighthouse) ───────────────────────
        'categories:performance': ['error', { minScore: 0.85 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        // SEO é nice-to-have pra B2B logado — não bloqueia
        'categories:seo': ['warn', { minScore: 0.8 }],

        // ─── Core Web Vitals (numericos) ──────────────────────────────
        'first-contentful-paint': ['error', { maxNumericValue: 2000 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 3000 }],
        'total-blocking-time': ['error', { maxNumericValue: 300 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],

        // ─── Outros budgets úteis ─────────────────────────────────────
        'speed-index': ['warn', { maxNumericValue: 3000 }],
        interactive: ['warn', { maxNumericValue: 4000 }],

        // ─── Ignora warns que não se aplicam a SPA logado ─────────────
        'meta-description': 'off', // SPA com auth — descrição não é critical
        'is-on-https': 'off', // local dev/CI rodam em http
        'uses-rel-preconnect': 'off',
      },
    },
    upload: {
      // Upload pra LHCI server seria opcional aqui — usamos `temporary-public-storage`
      // que gera URL pública compartilhável no GitHub Action log
      target: 'temporary-public-storage',
    },
  },
};
