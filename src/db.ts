import { z } from 'zod';
import {
  Feed,
  Node,
  Policy,
  Source,
  Network,
  DBNetwork,
  NodeSchema,
  FeedSchema,
  SourceSchema,
  PolicySchema,
  FactStatement,
  NetworkSchema,
  DBNetworkSchema,
  FactStatementSchema,
  Asset,
  AssetSchema
} from './util/types.js';
// import { sub } from 'date-fns';
import { logError } from './util/logger.js';
import PocketBase, { ClientResponseError } from 'pocketbase';
// import { format as formatZonedTime, toZonedTime } from 'date-fns-tz';

// Setup DB connection
const db = new PocketBase(process.env.DB_HOST);
await db.collection('_superusers').authWithPassword(process.env.DB_EMAIL, process.env.DB_PASSWORD);

export async function indexFactStatements(
  facts: Omit<FactStatement, 'id' | 'participating_nodes' | 'sources' | 'content_signature' | 'collection_date'>[]
): Promise<void> {
  const orderedFacts = facts.sort((a, b) => b.validation_date.getTime() - a.validation_date.getTime());

  let successfulCount = 0;
  let skippedCount = 0;

  const promises = orderedFacts.map((fact) => {
    return db
      .collection('facts')
      .create<FactStatement>(fact, {
        $autoCancel: false
      })
      .then(() => {
        successfulCount++;
      })
      .catch((error) => {
        if (isFactAlreadyIndexed(error)) {
          skippedCount++;
        } else {
          logError(
            `Error indexing fact statement: ${fact.fact_urn} from feed ${fact.feed} on network ${fact.network === 'l1ppggh4ls079w9' ? 'Mainnet' : 'Preview'}`,
            error
          );
        }
        throw error;
      });
  });

  await Promise.allSettled(promises);

  // Generate the log message based on the counts
  let logMessage = '';

  if (successfulCount > 0) {
    logMessage += `Successfully indexed ${successfulCount}`;
  }

  if (skippedCount > 0) {
    if (logMessage) logMessage += `, `;
    logMessage += `Skipped ${skippedCount} (already indexed)`;
  }

  console.info(logMessage);
}

export async function fetchFeeds(network: Network): Promise<Feed[]> {
  try {
    const feeds = await db.collection('feeds').getFullList<Feed>({ filter: `network = "${network.id}"` });
    return z.array(FeedSchema).parse(feeds);
  } catch (error) {
    logError('Error retrieving feeds', error);
    return [];
  }
}

export async function createFeed(feed: Omit<Feed, 'id'>): Promise<Feed | null> {
  try {
    const newFeed = await db.collection('feeds').create<Feed>(feed);
    return FeedSchema.parse(newFeed);
  } catch (error) {
    logError('Error adding feed record', error);
    return null;
  }
}

export async function isIndexEmpty(network: Network): Promise<boolean> {
  try {
    const facts = await db.collection('facts').getList(1, 1, { filter: `network = "${network.id}"` });
    if (facts.totalItems === 0) console.info(`${network.name} index is empty.`);
    return facts.totalItems === 0;
  } catch (error) {
    logError(`Error checking if ${network.name} index is empty`, error);
    return false;
  }
}

// TODO: Update to "dropIndex" and make sure everything gets dropped
export async function deleteIndex(network: Network) {
  try {
    console.info(`Deleting contents of all tables for ${network.name}...`);

    console.info(`Deleting all fact statements from ${network.name}...`);
    let hasFacts = true;

    while (hasFacts) {
      const facts = await db.collection('facts').getFullList<FactStatement>({ filter: `network = "${network.id}"` });

      if (facts.length === 0) {
        hasFacts = false;
      } else {
        const promises = facts.map((fact) =>
          db
            .collection('facts')
            .delete(fact.id, {
              $autoCancel: false
            })
            .catch((error) => {
              // Catch and return the error here to handle it in the filtering step.
              return { error };
            })
        );

        await Promise.allSettled(promises);
      }
    }
    console.log(`Deleted all fact statements from ${network.name}`);

    // Delete feeds for network
    const feeds = await fetchFeeds(network);
    for (const feed of feeds) {
      await db.collection('feeds').delete(feed.id);
    }
    console.info(`Deleted feeds for ${network.name}`);
  } catch (error) {
    logError(`Error deleting table contents for ${network.name}`, error);
  }
}

function isFactAlreadyIndexed(error: unknown): boolean {
  if (
    error instanceof ClientResponseError &&
    error.response.code === 400 &&
    Object.values(error.response.data).some(
      (value: unknown) =>
        typeof value === 'object' && value !== null && 'code' in value && value?.code === 'validation_not_unique'
    )
  )
    return true;
  else return false;
}

export async function updateNetwork(network: Partial<DBNetwork>) {
  try {
    if (!network.id) throw new Error('Network ID is required to update network');
    await db.collection('networks').update(network.id, network);
  } catch (error) {
    logError('Error updating network record', error);
  }
}

export async function deleteFactsOlderThanSlot(network: Network, slot: number) {
  try {
    const facts = await db.collection('facts').getFullList({
      filter: `network = "${network.id}" && slot > ${slot}`
    });

    for (const fact of facts) {
      await db.collection('facts').delete(fact.id);
    }

    console.log(`Deleted ${facts.length} facts older than slot ${slot}`);
  } catch (error) {
    logError(`Error deleting facts older than slot ${slot} `, error);
  }
}

export async function createPolicy(policy: Omit<Policy, 'id'>): Promise<Policy> {
  try {
    const newPolicy = await db.collection('policies').create<Policy>(policy, { requestKey: policy.policy_id });
    const parsedPolicy = PolicySchema.parse(newPolicy);
    return parsedPolicy;
  } catch (error) {
    logError('Error adding policy record', error);
    throw error;
  }
}

export async function createNetwork(networkData: Omit<DBNetwork, 'id'>): Promise<DBNetwork | null> {
  try {
    const newNetwork = await db.collection('networks').create<DBNetwork>(networkData, { requestKey: networkData.name });
    const parsedNetwork = DBNetworkSchema.parse(newNetwork);
    return parsedNetwork;
  } catch (error) {
    logError('Error creating network', error);
    return null;
  }
}

export async function getAllNetworks(): Promise<Network[]> {
  try {
    const response = await db.collection('networks').getFullList({
      expand: 'policies_via_network'
    });

    const networks: Network[] = response.map((networkRecord) => {
      const database = {
        fact_statements: `${networkRecord.name.toLowerCase()}_fact_statements`,
        feeds: `${networkRecord.name.toLowerCase()}_feeds`
      };
      const policies = networkRecord.expand?.policies_via_network
        ? z
            .array(PolicySchema)
            .parse(networkRecord.expand.policies_via_network)
            .sort((a, b) => b.starting_slot - a.starting_slot)
        : [];

      return NetworkSchema.parse({
        ...networkRecord,
        policies,
        database
      });
    });

    return networks;
  } catch (error) {
    logError('Error retrieving network records', error);
    return [];
  }
}

export async function getLastIndexedFact(network: Network): Promise<FactStatement> {
  try {
    const response = await db.collection('facts').getFirstListItem<FactStatement>(`network = "${network.id}"`, {
      sort: '-slot'
    });

    const latestFact = FactStatementSchema.parse(response);

    return latestFact;
  } catch (error) {
    logError('Error retrieving latest fact statement', error);
    throw error;
  }
}

export async function updateFeed(feed: Partial<Feed> & Pick<Feed, 'id'>) {
  try {
    await db.collection('feeds').update(feed.id, feed);
  } catch (error) {
    logError('Error updating feed record', error);
  }
}

// Generic utility function for fetching and parsing data from a URL
export async function fetchAndParse<T>(
  url: string,
  responseSchema: z.ZodSchema,
  headers: Record<string, string> = {}
): Promise<T> {
  try {
    const response = await fetch(url, {
      headers: new Headers(headers)
    });

    const data = await response.json();
    return responseSchema.parse(data) as T;
  } catch (error) {
    logError(`Error fetching or parsing data from ${url}`, error);
    throw error;
  }
}

export async function getAllNodes(network: Network): Promise<Node[]> {
  try {
    const response = await db.collection('nodes').getFullList({
      filter: `network = "${network.id}"`
    });

    const nodes = z.array(NodeSchema).parse(response);

    return nodes;
  } catch (error) {
    logError('Error retrieving node records', error);
    return [];
  }
}

export async function createNode(node: Omit<Node, 'id'>): Promise<Node | null> {
  try {
    const newNode = await db.collection('nodes').create<Node>(node);
    return NodeSchema.parse(newNode);
  } catch (error) {
    logError('Error adding node record', error);
    return null;
  }
}

export async function getAllSources(network: Network): Promise<Source[]> {
  try {
    const response = await db.collection('sources').getFullList({
      filter: `network = "${network.id}"`
    });

    const sources = z.array(SourceSchema).parse(response);

    return sources;
  } catch (error) {
    logError('Error retrieving source records', error);
    return [];
  }
}

export async function createSource(network: Network, source: Omit<Source, 'id'>): Promise<Source | null> {
  try {
    const newSource = await db.collection('sources').create<Source>(source);
    return SourceSchema.parse(newSource);
  } catch (error) {
    logError(`Error adding source record to ${network.name}. \n ${JSON.stringify(source, null, 2)}`, error);
    return null;
  }
}

export async function updateSource(source: Partial<Source>): Promise<Source | null> {
  try {
    if (!source.id) throw new Error('Source ID is required to update source');
    const updatedSource = await db.collection('sources').update<Source>(source.id, source);
    return updatedSource;
  } catch (error) {
    logError('Error updating source record', error);
    return null;
  }
}

export async function updateFactStatement(id: string, fact: Partial<FactStatement>) {
  try {
    await db.collection('facts').update(id, { ...fact });
  } catch (error) {
    logError('Error updating fact statement nodes', error);
  }
}

export async function getAllUnarchivedFacts(network: Network): Promise<FactStatement[]> {
  try {
    // const now = new Date();
    // const isoString = now.toISOString();
    // const timeString = isoString.split('T')[1].slice(0, 12) + 'Z';

    // const getFormattedDateFilter = (hours: number) => {
    //   const newDate = sub(now, {
    //     hours
    //   });
    //   return formatZonedTime(toZonedTime(newDate, 'UTC'), 'yyyy-MM-dd', { timeZone: 'UTC' }) + ' ' + timeString;
    // };
    // const oneHourAgo = getFormattedDateFilter(1);

    const response = await db.collection('facts').getFullList({
      filter: `network = "${network.id}" && is_archive_indexed = false && storage_urn != ""`
    });

    const facts = z.array(FactStatementSchema).parse(response);

    return facts;
  } catch (error) {
    logError('Error retrieving fact records', error);
    return [];
  }
}

export async function getAllFactStatements(network: Network): Promise<FactStatement[]> {
  try {
    const response = await db.collection('facts').getFullList({
      filter: `network = "${network.id}"`
    });

    const facts = z.array(FactStatementSchema).parse(response);

    return facts;
  } catch (error) {
    logError('Error retrieving fact records', error);
    return [];
  }
}

export async function getAssetByTicker(ticker: string): Promise<Asset | null> {
  try {
    const response = await db.collection('assets').getFirstListItem<Asset>(`ticker = "${ticker}"`);
    return AssetSchema.parse(response);
  } catch (error) {
    if (error instanceof ClientResponseError && error.response.code === 404) {
      return null;
    }
    logError('Error retrieving asset', error);
    return null;
  }
}

export async function createAsset(asset: Omit<Asset, 'id'>): Promise<Asset | null> {
  try {
    console.info(`Creating asset: ${asset.ticker}`);
    const newAsset = await db.collection('assets').create<Asset>(asset);
    return AssetSchema.parse(newAsset);
  } catch (error) {
    logError('Error adding asset record', error);
    return null;
  }
}

export async function getAllAssets(): Promise<Asset[]> {
  try {
    const response = await db.collection('assets').getFullList();
    return z.array(AssetSchema).parse(response);
  } catch (error) {
    logError('Error retrieving asset records', error);
    return [];
  }
}
