import { CronJob } from 'cron';
import { syncFeeds } from './util/feeds.js';
import { logError } from './util/logger.js';
import { getLastIndexedFact } from './db.js';
import { ActiveFeeds, Network } from './util/types.js';
import { getOrCreateLatestPolicy, syncFactStatements } from './kupo.js';

// Scan for fact statements to index and sync feeds if necessary
export async function initIndexSyncCronJob(networks: Network[]) {
  console.info('Initialized index sync cron job...');

  const cachedNetworks = networks;
  let cachedFeeds: ActiveFeeds;

  CronJob.from({
    cronTime: '0 */10 * * * *', // Every 10 minutes
    // cronTime: '0 */1 * * * *', // Every 1 minute
    timeZone: 'UTC',
    start: true,
    onTick: async function () {
      console.info('Syncing index...');

      for (const network of cachedNetworks) {
        try {
          console.info(`Syncing feeds for ${network.name}...`);
          const activeFeeds = await syncFeeds(network, cachedFeeds);
          cachedFeeds = activeFeeds;

          console.info(`Syncing policies for ${network.name}...`);
          const networkInCache = cachedNetworks.find((n) => n.name === network.name);
          const currentPolicy = network.policies[network.policies.length - 1];
          const latestPolicy = await getOrCreateLatestPolicy(network);
          // If the policy has changed, sync the fact statements for the previous policy and then the latest policy
          if (currentPolicy.policy_id !== latestPolicy.policy_id) {
            console.info(
              `Syncing fact statements for ${network.name} for the previous policy ID ${currentPolicy.policy_id}...`
            );
            const lastIndexedBeforeChange = await getLastIndexedFact(network);
            const queryStatePrev = await syncFactStatements(network, {
              lastBlockHash: lastIndexedBeforeChange.block_hash,
              lastCheckpointSlot: lastIndexedBeforeChange.slot,
              queryParams: {
                order: 'oldest_first',
                created_after: lastIndexedBeforeChange.slot.toString(),
                created_before: latestPolicy.starting_slot.toString()
              }
            });

            // Update cached network
            if (networkInCache) {
              networkInCache.policies.push(latestPolicy);
              networkInCache.last_block_hash = queryStatePrev.lastBlockHash;
              networkInCache.last_checkpoint_slot = queryStatePrev.lastCheckpointSlot;
            }
            network.policies.push(latestPolicy);
            network.last_block_hash = queryStatePrev.lastBlockHash;
            network.last_checkpoint_slot = queryStatePrev.lastCheckpointSlot;

            console.info(`Syncing latest fact statements for ${network.name}...`);
            const lastIndexedAfterChange = await getLastIndexedFact(network);
            const queryStateLatest = await syncFactStatements(network, {
              lastBlockHash: lastIndexedAfterChange.block_hash,
              lastCheckpointSlot: lastIndexedAfterChange.slot,
              queryParams: { order: 'oldest_first', created_after: lastIndexedAfterChange.slot.toString() }
            });
            if (networkInCache) {
              networkInCache.last_block_hash = queryStateLatest.lastBlockHash;
              networkInCache.last_checkpoint_slot = queryStateLatest.lastCheckpointSlot;
            }
          }
          // Just sync the latest fact statements if the policy hasn't changed
          else {
            console.info(`Syncing latest fact statements for ${network.name}...`);
            const queryState = await syncFactStatements(network);

            // Update network cache
            if (networkInCache) {
              networkInCache.last_block_hash = queryState.lastBlockHash;
              networkInCache.last_checkpoint_slot = queryState.lastCheckpointSlot;
            }
          }
        } catch (error) {
          logError(`An error occurred while syncing the index for network ${network.name}:`, error);
        }
      }
    }
  });
}
