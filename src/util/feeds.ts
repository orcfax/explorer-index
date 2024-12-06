import { logError } from './logger.js';
import { ActiveFeeds, ActiveFeedsSchema, Feed, Network } from './types.js';
import { createFeed, fetchAndParse, fetchFeeds as fetchStoredFeeds, updateFeed } from '../db.js';

export async function syncFeeds(network: Network, cache?: ActiveFeeds): Promise<ActiveFeeds> {
  try {
    const storedFeeds = await fetchStoredFeeds(network);
    const activeFeeds = await fetchActiveFeeds(network);

    if (cache && JSON.stringify(cache) === JSON.stringify(activeFeeds)) {
      console.info(`No changes in active feeds for ${network.name}`);
      return cache;
    }

    // Loop over the active feeds and either create or update them in the stored feeds
    const processedFeedIds = new Set<string>();
    for (const activeFeed of activeFeeds.feeds) {
      const feed_id = `${activeFeed.type}/${activeFeed.label}/3`;
      const existingFeed = storedFeeds.find((feed) => feed.feed_id === feed_id);

      if (existingFeed) {
        console.info(`Updating ${network.name} feed: ${feed_id}`);
        await updateFeed({
          id: existingFeed.id,
          type: activeFeed.type,
          name: activeFeed.label,
          status: 'active',
          source_type: activeFeed.source.toUpperCase() as Feed['source_type'],
          funding_type: activeFeed.status,
          calculation_method: activeFeed.calculation,
          heartbeat_interval: activeFeed.interval,
          deviation: activeFeed.deviation
        });
      } else {
        console.info(`Indexing ${network.name} feed: ${feed_id}`);
        await createFeed({
          network: network.id,
          feed_id,
          type: activeFeed.type,
          name: activeFeed.label,
          version: 3,
          status: 'active',
          source_type: activeFeed.source.toUpperCase() as Feed['source_type'],
          funding_type: activeFeed.status,
          calculation_method: activeFeed.calculation,
          heartbeat_interval: activeFeed.interval,
          deviation: activeFeed.deviation
        });
      }

      processedFeedIds.add(feed_id);
    }

    // Mark any stored feeds that are not in the active feeds list as inactive
    for (const storedFeed of storedFeeds) {
      if (!processedFeedIds.has(storedFeed.feed_id) && storedFeed.status === 'active') {
        console.info(`Marking feed ${network.name} feed as inactive: ${storedFeed.feed_id}`);
        await updateFeed({
          id: storedFeed.id,
          status: 'inactive'
        });
      }
    }

    return activeFeeds;
  } catch (error) {
    logError('Error syncing feeds', error);
    throw error;
  }
}

export async function fetchActiveFeeds(network: Network): Promise<ActiveFeeds> {
  // Required to get around GitHub raw caching issues
  // const githubCacheBuster = Math.floor(Date.now() / 1000);
  // return fetchAndParse<ActiveFeeds>(`${network.active_feeds_url}?token=${githubCacheBuster}`, ActiveFeedsSchema);
  return fetchAndParse<ActiveFeeds>(`${network.active_feeds_url}`, ActiveFeedsSchema);
}
