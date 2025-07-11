import { CronJob } from 'cron';
import { syncFeeds } from './util/feeds.js';
import { logError } from './util/logger.js';
import { indexArchives } from './util/archives.js';
import { ActiveFeeds, Network } from './util/types.js';
import { getAllUnarchivedFacts, getLastIndexedFact } from './db.js';
import { getOrCreateLatestPolicy, syncFactStatements } from './kupo.js';

// Scan for fact statements to index and sync feeds if necessary
export async function initIndexSyncCronJob(networks: Network[]) {
  console.info('\nInitialized index sync cron job...\n');

  const cachedNetworks = networks;
  let cachedFeeds: ActiveFeeds;

  CronJob.from({
    cronTime: '0 */10 * * * *', // Every 10 minutes
    // cronTime: '0 */1 * * * *', // Every 1 minute
    timeZone: 'UTC',
    start: true,
    onTick: async function () {
      for (const network of cachedNetworks) {
        console.info(`\n* Syncing index for ${network.name}...`);
        try {
          console.info(`\n* * Syncing feeds for ${network.name}...`);
          const activeFeeds = await syncFeeds(network, cachedFeeds);
          cachedFeeds = activeFeeds;

          console.info(`\n* * Syncing policies for ${network.name}...`);
          const networkInCache = cachedNetworks.find((n) => n.name === network.name);
          const currentPolicy = network.policies.sort((a, b) => b.starting_slot - a.starting_slot)[0];
          const latestPolicy = await getOrCreateLatestPolicy(network);
          // If the policy has changed, sync the fact statements for the previous policy and then the latest policy
          if (currentPolicy.policy_id !== latestPolicy.policy_id) {
            console.info(
              `\n* * Syncing fact statements for ${network.name} for the previous policy ID ${currentPolicy.policy_id}...`
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

            console.info(`\n* * Syncing fact statements for ${network.name}...`);
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
            console.info(`\n* * Syncing fact statements for ${network.name}...`);
            const queryState = await syncFactStatements(network);

            // Update network cache
            if (networkInCache) {
              networkInCache.last_block_hash = queryState.lastBlockHash;
              networkInCache.last_checkpoint_slot = queryState.lastCheckpointSlot;
            }
          }

          if (network.name === 'Mainnet') {
            const unarchived = await getAllUnarchivedFacts(network);
            await indexArchives(network, unarchived);
          }

          console.info(`\n* Finished syncing index for ${network.name}\n`);
        } catch (error) {
          logError(`An error occurred while syncing the index for network ${network.name}:`, error);
        }
      }
    }
  });
}
