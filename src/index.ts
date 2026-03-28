import { Hono } from "hono";
import type { Env, R2ReadmeMetadata } from "./types.js";
import { fetchGithubReadme, fetchGitlabReadme } from "./fetch-readme.js";
import { processReadme } from "./process.js";

const app = new Hono<{ Bindings: Env }>();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function r2Key(source: string, owner: string, repo: string): string {
  return `readmes/${source}/${owner}-${repo}.md`;
}

function isFresh(metadata: R2ReadmeMetadata): boolean {
  const cachedAt = new Date(metadata.cachedAt).getTime();
  return Date.now() - cachedAt < CACHE_TTL_MS;
}

function contentHash(body: string): string {
  // Simple fast hash for ETag — FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `"${hash.toString(16)}"`;
}

function readmeResponse(body: string, cacheStatus: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      ETag: contentHash(body),
      "X-Cache": cacheStatus,
    },
  });
}

async function fetchAndProcess(
  source: string,
  fullName: string,
  branch: string,
  path: string,
  env: Env,
  etag?: string,
) {
  const options = {
    etag,
    githubToken: env.GITHUB_TOKEN,
  };

  const result =
    source === "github"
      ? await fetchGithubReadme(fullName, branch, path, options)
      : await fetchGitlabReadme(fullName, branch, path, { etag });

  if (!result) return null; // 304 not modified

  const processed = await processReadme(result.content);
  return { processed, etag: result.etag };
}

// GET /readme/:source/:owner/:repo/:branch/:path
app.get("/readme/:source/:owner/:repo/:branch/:path", async (c) => {
  const { source, owner, repo, branch, path } = c.req.param();

  if (source !== "github" && source !== "gitlab") {
    return c.text("Invalid source. Use 'github' or 'gitlab'.", 400);
  }

  if (!path) {
    return c.text("Missing file path.", 400);
  }
  const fullName = `${owner}/${repo}`;
  const key = r2Key(source, owner, repo);

  // Check R2 cache
  const cached = await c.env.store_nvim_readmes.head(key);

  if (cached) {
    const metadata = cached.customMetadata as unknown as R2ReadmeMetadata;

    if (isFresh(metadata)) {
      // Cache HIT — serve from R2
      const obj = await c.env.store_nvim_readmes.get(key);
      if (obj) {
        const body = await obj.text();
        return readmeResponse(body, "HIT");
      }
    }

    // Cache STALE — serve immediately, revalidate in background
    const obj = await c.env.store_nvim_readmes.get(key);
    if (obj) {
      const body = await obj.text();

      c.executionCtx.waitUntil(
        (async () => {
          try {
            const fresh = await fetchAndProcess(
              source,
              fullName,
              branch,
              path,
              c.env,
              metadata.etag,
            );
            if (fresh) {
              await c.env.store_nvim_readmes.put(key, fresh.processed, {
                customMetadata: {
                  cachedAt: new Date().toISOString(),
                  etag: fresh.etag ?? "",
                  source,
                },
              });
            } else {
              // 304 — content unchanged, just bump the timestamp
              await c.env.store_nvim_readmes.put(key, body, {
                customMetadata: {
                  cachedAt: new Date().toISOString(),
                  etag: metadata.etag ?? "",
                  source,
                },
              });
            }
          } catch (err) {
            console.error(`Background revalidation failed for ${fullName}:`, err);
          }
        })(),
      );

      return readmeResponse(body, "STALE");
    }
  }

  // Cache MISS — fetch, process, store, return
  try {
    const result = await fetchAndProcess(
      source,
      fullName,
      branch,
      path,
      c.env,
    );

    if (!result) {
      return c.text("Unexpected 304 on cache miss", 502);
    }

    await c.env.store_nvim_readmes.put(key, result.processed, {
      customMetadata: {
        cachedAt: new Date().toISOString(),
        etag: result.etag ?? "",
        source,
      },
    });

    return readmeResponse(result.processed, "MISS");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fetch failed for ${fullName}:`, err);

    if (message.includes("404")) {
      return c.text(`README not found: ${fullName}`, 404);
    }

    return c.text(`Upstream error: ${message}`, 502);
  }
});

// PUT /readme/:source/:owner/:repo/:branch/:path — force refresh (protected)
app.put("/readme/:source/:owner/:repo/:branch/:path", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth || auth !== `Bearer ${c.env.ADMIN_TOKEN}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { source, owner, repo, branch, path } = c.req.param();

  if (source !== "github" && source !== "gitlab") {
    return c.text("Invalid source. Use 'github' or 'gitlab'.", 400);
  }

  const fullName = `${owner}/${repo}`;
  const key = r2Key(source, owner, repo);

  try {
    const result = await fetchAndProcess(
      source,
      fullName,
      branch,
      path,
      c.env,
    );

    if (!result) {
      return c.text("Unexpected 304 on force refresh", 502);
    }

    await c.env.store_nvim_readmes.put(key, result.processed, {
      customMetadata: {
        cachedAt: new Date().toISOString(),
        etag: result.etag ?? "",
        source,
      },
    });

    return readmeResponse(result.processed, "REFRESH");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Force refresh failed for ${fullName}:`, err);

    if (message.includes("404")) {
      return c.text(`README not found: ${fullName}`, 404);
    }

    return c.text(`Upstream error: ${message}`, 502);
  }
});

// DELETE /cache — purge all cached READMEs (protected)
app.delete("/cache", async (c) => {
  const auth = c.req.header("Authorization");
  if (!auth || auth !== `Bearer ${c.env.ADMIN_TOKEN}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    let deleted = 0;
    let cursor: string | undefined;

    do {
      const list = await c.env.store_nvim_readmes.list({ cursor });

      if (list.objects.length > 0) {
        await Promise.all(
          list.objects.map((obj) => c.env.store_nvim_readmes.delete(obj.key)),
        );
        deleted += list.objects.length;
      }

      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    return c.json({ deleted });
  } catch (err) {
    console.error("Cache purge failed:", err);
    return c.json({ error: "Purge failed" }, 500);
  }
});

export default app;
