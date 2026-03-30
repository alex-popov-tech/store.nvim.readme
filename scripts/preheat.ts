/**
 * Preheat the README cache by fetching, processing, and writing directly to R2.
 *
 * Usage: npx tsx scripts/preheat.ts
 *
 * Environment:
 *   R2_ACCOUNT_ID      - Cloudflare account ID
 *   R2_ACCESS_KEY_ID   - R2 API token access key
 *   R2_SECRET_ACCESS_KEY - R2 API token secret key
 *   CONCURRENCY        - Parallel requests (default: 10)
 */

import pLimit from "p-limit";
import { AwsClient } from "aws4fetch";
import { fetchGithubReadme, fetchGitlabReadme } from "../src/fetch-readme.js";
import { processReadme } from "../src/process.js";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = "store-nvim-readmes";
const CONCURRENCY = parseInt(process.env.CONCURRENCY || "10", 10);

const DB_URL =
  "https://github.com/alex-popov-tech/store.nvim.crawler/releases/latest/download/db_minified.json";

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error(
    "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are required",
  );
  process.exit(1);
}

const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}`;

type DbItem = {
  full_name?: string;
  source?: string;
  readme?: string;
};

async function fetchDb(): Promise<DbItem[]> {
  console.log("Fetching db.json from crawler release...");
  const resp = await fetch(DB_URL, {
    headers: { "User-Agent": "store.nvim-preheat" },
  });
  if (!resp.ok) throw new Error(`Failed to fetch db.json: ${resp.status}`);
  const db = (await resp.json()) as { items: DbItem[] };
  return db.items;
}

function r2Key(source: string, owner: string, repo: string): string {
  return `readmes/${source}/${owner}-${repo}.md`;
}

async function putToR2(
  key: string,
  body: string,
  metadata: Record<string, string>,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
  };
  for (const [k, v] of Object.entries(metadata)) {
    headers[`x-amz-meta-${k}`] = v;
  }

  const resp = await r2.fetch(`${R2_ENDPOINT}/${key}`, {
    method: "PUT",
    headers,
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`R2 PUT failed (${resp.status}): ${text.slice(0, 200)}`);
  }
}

const skipped: string[] = [];
const errors: string[] = [];

async function preheatRepo(
  item: DbItem,
): Promise<"ok" | "skip" | "error"> {
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
  const [owner, repo] = item.full_name.split("/");
  const key = r2Key(item.source, owner, repo);

  try {
    const result =
      item.source === "github"
        ? await fetchGithubReadme(item.full_name, branch, path)
        : await fetchGitlabReadme(item.full_name, branch, path);

    if (!result) {
      skipped.push(`${item.full_name} — 304 not modified`);
      return "skip";
    }

    const processed = await processReadme(result.content);
    const now = new Date().toISOString();

    await putToR2(key, processed, {
      cachedAt: now,
      processedAt: now,
      etag: result.etag ?? "",
      source: item.source,
    });

    return "ok";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`${item.full_name} — ${msg}`);
    return "error";
  }
}

async function main() {
  const items = await fetchDb();
  console.log(
    `Found ${items.length} repos. Preheating with concurrency=${CONCURRENCY}...\n`,
  );

  const stats = { ok: 0, error: 0, skip: 0 };
  let done = 0;
  const startTime = Date.now();
  const limit = pLimit(CONCURRENCY);

  const tasks = items.map((item) =>
    limit(async () => {
      const r = await preheatRepo(item);
      stats[r]++;
      done++;
      if (done % 200 === 0 || done === items.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(
          `  ${done}/${items.length} (${elapsed}s) — ok:${stats.ok} err:${stats.error} skip:${stats.skip}`,
        );
      }
    }),
  );

  await Promise.all(tasks);

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
