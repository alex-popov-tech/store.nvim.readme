export type FetchResult = {
  content: string;
  etag?: string;
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export async function fetchGithubReadme(
  fullName: string,
  branch: string,
  path: string,
  options?: { etag?: string; githubToken?: string },
): Promise<FetchResult | null> {
  const url = `https://raw.githubusercontent.com/${fullName}/${branch}/${path}`;

  const headers: Record<string, string> = {
    "User-Agent": "store.nvim-readme-cache",
  };
  if (options?.etag) {
    headers["If-None-Match"] = options.etag;
  }
  if (options?.githubToken) {
    headers["Authorization"] = `token ${options.githubToken}`;
  }

  const resp = await fetchWithRetry(url, { headers });

  if (resp.status === 304) return null;

  if (!resp.ok) {
    throw new Error(`GitHub ${resp.status}: ${await resp.text()}`);
  }

  return {
    content: await resp.text(),
    etag: resp.headers.get("etag") ?? undefined,
  };
}

export async function fetchGitlabReadme(
  fullName: string,
  branch: string,
  path: string,
  options?: { etag?: string },
): Promise<FetchResult | null> {
  const url = `https://gitlab.com/${fullName}/-/raw/${branch}/${path}?ref_type=heads`;

  const headers: Record<string, string> = {
    "User-Agent": "store.nvim-readme-cache",
  };
  if (options?.etag) {
    headers["If-None-Match"] = options.etag;
  }

  const resp = await fetchWithRetry(url, { headers });

  if (resp.status === 304) return null;

  if (!resp.ok) {
    throw new Error(`GitLab ${resp.status}: ${await resp.text()}`);
  }

  return {
    content: await resp.text(),
    etag: resp.headers.get("etag") ?? undefined,
  };
}
