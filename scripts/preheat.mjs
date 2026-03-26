/**
 * Preheat the README cache by requesting all repos from db.json.
 *
 * Usage: node scripts/preheat.mjs
 *
 * Environment:
 *   BASE_URL     - Worker URL (default: https://store-nvim-readme.oleksandrp.com)
 *   CONCURRENCY  - Parallel requests (default: 10)
 */

const BASE_URL =
  process.env.BASE_URL || "https://store-nvim-readme.oleksandrp.com";
const DB_URL =
  "https://github.com/alex-popov-tech/store.nvim.crawler/releases/latest/download/db_minified.json";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "10", 10);

async function fetchDb() {
  console.log(`Fetching db.json from crawler release...`);
  const resp = await fetch(DB_URL, {
    headers: { "User-Agent": "store.nvim-preheat" },
  });
  if (!resp.ok) throw new Error(`Failed to fetch db.json: ${resp.status}`);
  const db = await resp.json();
  return db.items;
}

const skipped = [];
const errors = [];

async function preheatRepo(item) {
  if (!item.full_name || !item.source) {
    skipped.push(`${item.full_name || "?"} — missing full_name or source`);
    return "skip";
  }
  if (!item.readme) {
    skipped.push(`${item.full_name} — no readme field`);
    return "skip";
  }

  const slashIdx = item.readme.indexOf("/");
  if (slashIdx === -1) {
    skipped.push(`${item.full_name} — bad readme format: ${item.readme}`);
    return "skip";
  }

  const branch = item.readme.slice(0, slashIdx);
  const path = item.readme.slice(slashIdx + 1);
  const url = `${BASE_URL}/readme/${item.source}/${item.full_name}/${branch}/${path}`;

  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "store.nvim-preheat" },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      errors.push(`${item.full_name} — ${resp.status} ${body.slice(0, 80)}`);
      return "error";
    }
    return resp.headers.get("x-cache") || "unknown";
  } catch (err) {
    errors.push(`${item.full_name} — ${err.message || err}`);
    return "error";
  }
}

async function main() {
  const items = await fetchDb();
  console.log(
    `Found ${items.length} repos. Preheating with concurrency=${CONCURRENCY}...\n`,
  );

  const stats = { HIT: 0, MISS: 0, STALE: 0, error: 0, skip: 0, unknown: 0 };
  let done = 0;
  const startTime = Date.now();

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(preheatRepo));

    for (const r of results) {
      stats[r] = (stats[r] || 0) + 1;
    }

    done += batch.length;
    if (done % 200 === 0 || done === items.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(
        `  ${done}/${items.length} (${elapsed}s) — MISS:${stats.MISS} HIT:${stats.HIT} STALE:${stats.STALE} err:${stats.error} skip:${stats.skip}`,
      );
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${totalTime}s. ${JSON.stringify(stats)}`);

  if (skipped.length > 0) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  - ${e}`);
  }

  if (stats.error > items.length * 0.1) {
    console.error("\nToo many errors (>10%), failing.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
