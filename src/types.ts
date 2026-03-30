export type Env = {
  store_nvim_readmes: R2Bucket;
  ADMIN_TOKEN: string;
};

export type R2ReadmeMetadata = {
  cachedAt: string;
  processedAt: string;
  etag?: string;
  source: string;
};
