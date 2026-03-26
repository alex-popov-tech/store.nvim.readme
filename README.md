# store.nvim.readme

README CDN and processing service for [store.nvim](https://github.com/alex-popov-tech/store.nvim). Fetches raw READMEs from GitHub/GitLab, processes them (strips HTML, removes badges, filters unsupported images), caches in R2, and serves pre-cleaned markdown. Built on Cloudflare Workers + R2 (free tier compatible).

## Why

Every store.nvim user fetches and processes the same READMEs independently. This service centralizes that work — process once, serve to all. Also moves string processing from Lua to TypeScript with a proper markdown AST parser (remark/unified).

## Processing Pipeline

Raw markdown is parsed into an AST (remark) and transformed:

1. **Convert `<img>` tags** to markdown image syntax
2. **Convert HTML headings/paragraphs** — `<h3>Title</h3>` becomes `### Title`, `<p>text</p>` becomes a paragraph
3. **Remove badge images** — shields.io, badge.fury.io, badgen.net, codecov, coveralls, travis-ci, circleci, GitHub Actions badges
4. **Remove unsupported images** — `.svg` and `.gif` (not supported by kitty image protocol)
5. **Strip remaining HTML** — extracts text content from `<div>`, `<details>`, `<table>`, etc.
6. **Decode HTML entities** — `&amp;` `&lt;` `&#39;` etc.
7. **Collapse blank lines** — max 1 consecutive blank line

Code blocks are preserved verbatim throughout.

## Setup

```bash
# Install dependencies
npm install

# Start local dev server (R2 emulated by Miniflare)
npm run dev

# Run unit tests
npm test

# Deploy to Cloudflare Workers
npx wrangler r2 bucket create store-nvim-readmes
npx wrangler secret put ADMIN_TOKEN    # generate with: openssl rand -hex 32
npx wrangler secret put GITHUB_TOKEN   # optional, for higher GitHub rate limits
npm run deploy
```

## API

### `GET /readme/:source/:owner/:repo/:branch/:path`

Fetch a processed README.

```bash
curl https://store-nvim-readme.oleksandrp.com/readme/github/folke/lazy.nvim/main/README.md

curl https://store-nvim-readme.oleksandrp.com/readme/github/catppuccin/nvim/main/README.md

curl https://store-nvim-readme.oleksandrp.com/readme/gitlab/someone/plugin/main/README.md
```

**Parameters:**
- `source` — `github` or `gitlab`
- `owner` / `repo` — repository owner and name
- `branch` — branch name (e.g. `main`, `master`, `HEAD`)
- `path` — file name (e.g. `README.md`)

**Response headers:**
- `Content-Type: text/plain; charset=utf-8`
- `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`
- `ETag` — content hash
- `X-Cache` — `HIT`, `MISS`, or `STALE`

**Cache behavior:**
- **HIT** — served from R2, cached less than 24 hours ago
- **STALE** — served from R2 immediately, background revalidation triggered (uses GitHub ETags for conditional requests)
- **MISS** — fetched from upstream, processed, stored in R2, then returned

**Error responses:**
- `400` — invalid source or missing path
- `404` — README not found upstream
- `502` — upstream fetch error

### `DELETE /cache`

Purge all cached READMEs. Protected by bearer token.

```bash
curl -X DELETE https://store-nvim-readme.oleksandrp.com/cache \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

**Responses:**
- `200 { "deleted": 42 }` — cache purged
- `401` — unauthorized
- `500` — purge failed

## Local Development

```bash
npm run dev        # start dev server at http://localhost:8787
npm test           # run unit tests (56 tests)
npm run test:watch # run tests in watch mode
```

Local dev uses `ADMIN_TOKEN=dev-token` from `wrangler.toml`.

## Architecture

- **Cloudflare Workers** — edge compute (300+ locations)
- **R2** — object storage for cached processed READMEs (zero egress fees)
- **Hono** — lightweight HTTP framework (12KB)
- **remark/unified** — markdown AST parsing and transformation
