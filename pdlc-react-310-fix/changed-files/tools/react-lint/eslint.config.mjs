import { fileURLToPath } from 'node:url';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Enforces React's rules of hooks on the shipping Vite app.
 *
 * The repository-root eslint.config.mjs targets the legacy Next.js sources, so
 * nothing was checking apps/web/src. That gap let a hook move below an early
 * return, which reaches the browser as React error #310 ("Rendered more hooks
 * than during the previous render") and blanks the page. This config closes it.
 */
export default tseslint.config({
  // ESLint resolves `files` against basePath (the repo root, set below), so the config can
  // live outside the app without every path needing to be absolute.
  basePath: fileURLToPath(new URL('../..', import.meta.url)),
  files: ['apps/web/src/**/*.{ts,tsx}'],
  ignores: ['apps/web/src/**/*.test.ts', 'apps/web/src/**/*.test.tsx', 'apps/web/dist/**'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 'latest', sourceType: 'module' }
  },
  plugins: { 'react-hooks': reactHooks },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    // Dependency arrays are reviewed by hand; turning this on would bury the
    // hook-order signal under pre-existing warnings.
    'react-hooks/exhaustive-deps': 'off'
  }
});
