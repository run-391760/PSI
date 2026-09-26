<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SynapseSEO project notes

Semrush-class SEO platform. Read `docs/BUILD-BRIEF.md` for architecture, conventions, the UI kit and data
provenance rules before changing code. Dev server: `npm run dev` (http://127.0.0.1:3200). Screenshots:
`node scripts/shot.mjs <outDir> <path...>`. Demo data engine: `src/lib/seo/engine` (deterministic,
always labelled "Demo data" in the UI). PGlite in `.data/postgres` is single-process.
