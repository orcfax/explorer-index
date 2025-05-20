import { logError } from './logger.js';
import { ActiveFeeds, ActiveFeedsSchema, Asset, Feed, Network } from './types.js';
import {
  createFeed,
  fetchAndParse,
  fetchFeeds as fetchStoredFeeds,
  updateFeed,
  createAsset,
  getAllAssets
} from '../db.js';

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

      if (!existingFeed || isFeedChanged(activeFeed, existingFeed)) {
        // Extract and get/create assets
        const { base, quote } = extractTickersFromFeedName(activeFeed.label);
        const assets = await getOrCreateAssets([base, quote]);
        const baseAssetId = assets.find((asset) => asset.ticker === base)?.id;
        const quoteAssetId = assets.find((asset) => asset.ticker === quote)?.id;
        if (!baseAssetId || !quoteAssetId) {
          throw new Error(`Failed to create assets for ${base} and ${quote}`);
        }

        if (!existingFeed) {
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
            deviation: activeFeed.deviation,
            base_asset: baseAssetId,
            quote_asset: quoteAssetId
          });
        } else if (isFeedChanged(activeFeed, existingFeed)) {
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
            deviation: activeFeed.deviation,
            base_asset: baseAssetId,
            quote_asset: quoteAssetId
          });
        }
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
  return fetchAndParse<ActiveFeeds>(`${network.active_feeds_url}`, ActiveFeedsSchema);
}

function isFeedChanged(activeFeed: ActiveFeeds['feeds'][number], storedFeed: Feed): boolean {
  return (
    activeFeed.label !== storedFeed.name ||
    activeFeed.source.toUpperCase() !== storedFeed.source_type ||
    activeFeed.status !== storedFeed.funding_type ||
    activeFeed.calculation !== storedFeed.calculation_method ||
    activeFeed.interval !== storedFeed.heartbeat_interval ||
    activeFeed.deviation !== storedFeed.deviation
  );
}

export async function getOrCreateAssets(tickers: string[]): Promise<Asset[]> {
  const existingAssets = await getAllAssets();
  const resultAssets: Asset[] = [];

  for (const ticker of tickers) {
    const tickerLower = ticker.toLowerCase();
    const existingAsset = existingAssets.find((asset) => asset.ticker.toLowerCase() === tickerLower);

    if (existingAsset) {
      resultAssets.push(existingAsset);
    } else {
      const newAsset = await createAsset({
        ticker: ticker
      });

      if (!newAsset) {
        throw new Error(`Failed to create asset for ticker: ${ticker}`);
      }

      resultAssets.push(newAsset);
    }
  }

  return resultAssets;
}

export function extractTickersFromFeedName(feedName: string): { base: string; quote: string } {
  // Feed names are typically in the format "BASE/QUOTE" or "BASE-QUOTE"
  const parts = feedName.split(/[/-]/);
  if (parts.length !== 2) {
    throw new Error(`Invalid feed name format: ${feedName}`);
  }
  return {
    base: parts[0].trim(),
    quote: parts[1].trim()
  };
}
