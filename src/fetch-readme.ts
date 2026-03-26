export type FetchResult = {
  content: string;
  etag?: string;
};

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

  const resp = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

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

  const resp = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (resp.status === 304) return null;

  if (!resp.ok) {
    throw new Error(`GitLab ${resp.status}: ${await resp.text()}`);
  }

  return {
    content: await resp.text(),
    etag: resp.headers.get("etag") ?? undefined,
  };
}
