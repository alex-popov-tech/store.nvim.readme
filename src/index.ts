import { Hono } from "hono";
import type { Env } from "./types.js";

const app = new Hono<{ Bindings: Env }>();

function r2Key(source: string, owner: string, repo: string): string {
  return `readmes/${source}/${owner}-${repo}.md`;
}

function contentHash(body: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    hash ^= body.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `"${hash.toString(16)}"`;
}

function rawUrl(
  source: string,
  fullName: string,
  branch: string,
  path: string,
): string {
  if (source === "gitlab") {
    return `https://gitlab.com/${fullName}/-/raw/${branch}/${path}?ref_type=heads`;
  }
  return `https://raw.githubusercontent.com/${fullName}/${branch}/${path}`;
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

  const obj = await c.env.store_nvim_readmes.get(key);

  if (obj) {
    const body = await obj.text();
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        ETag: contentHash(body),
      },
    });
  }

  return c.redirect(rawUrl(source, fullName, branch, path), 307);
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
