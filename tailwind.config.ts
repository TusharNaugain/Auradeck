import type { Config } from 'tailwindcss'

/**
 * Design tokens live in src/app/globals.css (@theme) — Tailwind v4 scans sources
 * automatically, so this file only pins the source globs and dark-mode strategy.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/hooks/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {},
  plugins: [],
}

export default config
