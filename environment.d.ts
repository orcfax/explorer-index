declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      DB_HOST: string;
      DB_EMAIL: string;
      DB_PASSWORD: string;
      MAINNET_CHAIN_INDEX_BASE_URL: string;
      PREVIEW_CHAIN_INDEX_BASE_URL: string;
      DISCORD_WEBHOOK_URL: string;
      PRIMARY_ARWEAVE_ENDPOINT: string;
      SECONDARY_ARWEAVE_ENDPOINT: string;
    }
  }
}

export {};
