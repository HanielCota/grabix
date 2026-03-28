export interface AppConfig {
  limits: {
    fetchTimeoutMs: number;
    maxHtmlSizeBytes: number;
    maxAssets: number;
    maxFileSizeBytes: number;
    maxConcurrentDownloads: number;
  };
}

export const appConfig: AppConfig = {
  limits: {
    fetchTimeoutMs: 15_000,
    maxHtmlSizeBytes: 10 * 1024 * 1024, // 10 MB
    maxAssets: 200,
    maxFileSizeBytes: 100 * 1024 * 1024, // 100 MB
    maxConcurrentDownloads: 5,
  },
};
