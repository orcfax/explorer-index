import 'dotenv/config';
import { isIndexEmpty } from './db.js';
import { logError } from './util/logger.js';
import { initIndexSyncCronJob } from './cron.js';
import { getNetworks, populateIndex } from './kupo.js';

try {
  console.info('\nBooting up Explorer Index...');

  // Setup Networks
  const networks = await getNetworks();

  // Setup Fact Statements
  for (const network of networks) {
    if (await isIndexEmpty(network)) {
      await populateIndex(network);
    }
  }

  // Setup Cron Jobs
  initIndexSyncCronJob(networks);
} catch (error) {
  logError('Unhandled exception', error);
}
