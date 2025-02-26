import { z } from 'zod';
import cbor from 'cbor';
import {
  createFeed,
  fetchFeeds,
  createPolicy,
  fetchAndParse,
  createNetwork,
  updateNetwork,
  getAllNetworks,
  indexFactStatements,
  deleteFactsOlderThanSlot,
  updateFactStatement
} from './db.js';
import {
  Policy,
  Network,
  KupoMatch,
  DBNetwork,
  DatumSchema,
  FeedIdSchema,
  PolicySchema,
  FactStatement,
  NetworkSchema,
  OrcfaxToSSchema,
  KupoMatchSchema,
  CurrencyPairDatum,
  KupoMatchesSchema,
  KupoDatumResponse,
  KupoRequestOptions,
  TransactionMetadata,
  KupoMatchesResponse,
  KupoMetadataResponse,
  KupoDatumResponseSchema,
  KupoMatchesByTransaction,
  KupoMetadataResponseSchema,
  NetworkSeed
} from './util/types.js';
import blake2b from 'blake2b';
import { logError } from './util/logger.js';
import { dateToSlot, NetworkSeeds, slotAfterTimePeriod, slotToDate } from './util/network.js';
import { syncFeeds } from './util/feeds.js';

// Populate the index from scratch for a given network by
// fetching time-based batches of matches from a Kupo instance
export async function populateIndex(network: Network) {
  console.info(`\nPopulating index for ${network.name}...`);

  console.info(`\nPopulating active feeds for ${network.name}...`);
  await syncFeeds(network);

  let lastCheckpointSlot;
  let lastBlockHash;
  const policies = network.policies.sort((a, b) => a.starting_slot - b.starting_slot);

  for (const policy of policies) {
    console.info(`\nIndexing facts for ${network.name} policy: ${policy.policy_id}...`);
    const latestSlot = dateToSlot(new Date(), network);
    const originSlot = network.policies[0].starting_slot;
    let currentSlot = originSlot;

    while (currentSlot < latestSlot) {
      const nextSlot = slotAfterTimePeriod(currentSlot, 'day', network);
      const queryEndSlot = nextSlot < latestSlot ? nextSlot : latestSlot;

      // TODO: Finish wiring up response streaming from Kupo
      // await processJsonStream(url);

      const response = await fetchMatchesFromKupo(
        network,
        {
          lastBlockHash: null,
          lastCheckpointSlot: null,
          queryParams: {
            order: 'oldest_first',
            created_after: currentSlot.toString(),
            created_before: queryEndSlot.toString()
          }
        },
        policy
      );

      if (response === null) return;

      // TODO: Index historical archives
      await parseAndIndexMatches(network, response.transactions);

      currentSlot = queryEndSlot;
      lastBlockHash = response.lastBlockHash;
      lastCheckpointSlot = response.lastCheckpointSlot;
    }
  }

  // Create initial network query cache
  await updateNetwork({
    id: network.id,
    last_checkpoint_slot: lastCheckpointSlot,
    last_block_hash: lastBlockHash
  });

  console.info(`Index populated for ${network.name}`);
}

export async function getNetworks(): Promise<Network[]> {
  try {
    const existingNetworks = await getAllNetworks();

    // Check if any networks are missing and populate them if they are
    const names = existingNetworks.map((network) => network.name);
    const missingSeeds = NetworkSeeds.filter((seed) => !names.includes(seed.name));
    const newlyPopulatedNetworks = await Promise.all(missingSeeds.map((seed) => populateNetwork(seed)));
    const successfullyPopulatedNetworks = newlyPopulatedNetworks.filter(Boolean) as Network[];

    return [...existingNetworks, ...successfullyPopulatedNetworks];
  } catch (error) {
    logError('Error while fetching or populating networks', error);
    return [];
  }
}

async function populateNetwork(seed: NetworkSeed): Promise<Network | null> {
  try {
    if (!seed.is_enabled) return null;

    const network = await createNetwork(seed);
    if (!network) throw new Error(`Failed to create network: ${seed.name}`);
    else console.info(`Created network: ${network.name}`);

    const policies = await populatePolicyIDs(network, seed);
    const populatedNetwork = NetworkSchema.parse({
      ...network,
      policies
    });

    return populatedNetwork;
  } catch (error) {
    logError(`Error populating network: ${seed.name}`, error);
    return null;
  }
}

async function populatePolicyIDs(network: DBNetwork, seed: NetworkSeed): Promise<Policy[]> {
  try {
    // Fetch all policy ID matches from Kupo
    const url = `${network.chain_index_base_url}/matches/*?policy_id=${network.fact_statement_pointer}&asset_name=${network.script_token}&order=oldest_first`;
    const policyMatches = await fetchAndParse<KupoMatch[]>(url, z.array(KupoMatchSchema));

    // Fetch and parse policies from datums
    const policies = await Promise.all(
      policyMatches.map(async (match) => {
        const datumUrl = `${network.chain_index_base_url}/datums/${match.datum_hash}`;
        const datumResponse = await fetchAndParse<KupoDatumResponse>(datumUrl, KupoDatumResponseSchema);
        const datum = datumResponse.datum;
        const decoded = cbor.decodeFirstSync(datum);
        const policy_id = decoded.toString('hex');

        // Construct policy object
        return {
          network: network.id,
          policy_id,
          starting_slot: match.created_at.slot_no,
          starting_block_hash: match.created_at.header_hash,
          starting_date: slotToDate(match.created_at.slot_no, network)
        };
      })
    );

    // Filter out duplicate policy_id objects, keeping the first instance
    const uniquePolicies = policies.filter(
      (policy, index, self) => index === self.findIndex((p) => p.policy_id === policy.policy_id)
    );

    // Filter out policies to ignore from seed
    const filteredPolicies = uniquePolicies.filter((policy) => !seed.ignore_policies.includes(policy.policy_id));

    // Create policies
    const createdPolicies = await Promise.all(filteredPolicies.map(createPolicy));
    createdPolicies.forEach((policy) => console.log(`Created ${network.name} policy: ${policy.policy_id}`));
    return createdPolicies;
  } catch (error) {
    logError(`Error populating policy IDs for network ${network.name}`, error);
    return [];
  }
}

export async function getOrCreateLatestPolicy(network: Network): Promise<Policy> {
  try {
    // Get current cached policy ID
    if (network.policies.length === 0)
      throw new Error(`No policies found for network: ${network.name}. There should be at least one policy.`);
    const currentPolicy = network.policies[network.policies.length - 1];

    // Fetch latest policy ID from Kupo
    const url = `${network.chain_index_base_url}/matches/*?policy_id=${network.fact_statement_pointer}&unspent&asset_name=${network.script_token}&order=most_recent_first`;
    const policyMatches = await fetchAndParse<KupoMatch[]>(url, z.array(KupoMatchSchema));
    if (!policyMatches || policyMatches.length === 0) throw new Error('No matches found from Kupo');
    const datumUrl = `${network.chain_index_base_url}/datums/${policyMatches[0].datum_hash}`;
    const datumResponse = await fetchAndParse<KupoDatumResponse>(datumUrl, KupoDatumResponseSchema);
    const decoded = cbor.decodeFirstSync(datumResponse.datum);
    const fetchedPolicyID = decoded.toString('hex');

    // Skip if the new policy has the same policy ID as an existing policy
    const policyAlreadyExists = network.policies.some((policy) => policy.policy_id === fetchedPolicyID);

    // Handle FSP policy ID change
    if (policyAlreadyExists) {
      return currentPolicy;
    } else {
      console.info(`Detected ${network.name} FSP change...`);
      const newPolicy = PolicySchema.parse({
        network: network.id,
        policy_id: fetchedPolicyID,
        starting_slot: policyMatches[0].created_at.slot_no,
        starting_block_hash: policyMatches[0].created_at.header_hash,
        starting_date: slotToDate(policyMatches[0].created_at.slot_no, network)
      });
      const createdPolicy = await createPolicy(newPolicy);
      console.info(`Created new ${network.name} policy: ${createdPolicy.policy_id}`);
      return createdPolicy;
    }
  } catch (error) {
    logError(`Error retrieving or indexing the latest policy ID for network ${network.name}`, error);
    throw error;
  }
}

// Sync latest matches for a given network from a Kupo instance
export async function syncFactStatements(
  network: Network,
  options?: KupoRequestOptions
): Promise<{ lastCheckpointSlot: number; lastBlockHash: string }> {
  const requestOptions = options || {
    lastBlockHash: network.last_block_hash,
    lastCheckpointSlot: network.last_checkpoint_slot,
    queryParams: {
      order: 'oldest_first',
      created_after: network.last_checkpoint_slot.toString()
    }
  };

  const response = await fetchMatchesFromKupo(network, requestOptions);
  if (response === null)
    return { lastCheckpointSlot: network.last_checkpoint_slot, lastBlockHash: network.last_block_hash };

  await parseAndIndexMatches(network, response.transactions);

  // Update network query cache
  await updateNetwork({
    id: network.id,
    last_checkpoint_slot: response.lastCheckpointSlot,
    last_block_hash: response.lastBlockHash
  });

  return { lastCheckpointSlot: response.lastCheckpointSlot, lastBlockHash: response.lastBlockHash };
}

export async function fetchMatchesFromKupo(
  network: Network,
  options: KupoRequestOptions, // Checkpoint slot and block hash should be sent for every sync iteration
  policy?: Policy
): Promise<KupoMatchesResponse | null> {
  try {
    const policyToSearch = policy ?? network.policies[network.policies.length - 1];
    const response = await fetch(
      `${network.chain_index_base_url}/matches/${policyToSearch.policy_id}.*?${options.queryParams ? new URLSearchParams(options.queryParams) : ''}`,
      {
        headers: {
          ...(options.lastBlockHash ? { 'If-None-Match': options.lastBlockHash } : {})
        }
      }
    );

    if (response.status === 304) {
      console.log('No new blocks to fetch from Kupo');
      return null;
    } else {
      const mostRecentCheckpointSlot = parseInt(response.headers.get('x-most-recent-checkpoint') || '0');
      const mostRecentBlockHash = response.headers.get('etag') || '';
      if (mostRecentCheckpointSlot === 0 || mostRecentBlockHash === '')
        throw new Error('Expected checkpoint slot and block hash but found none');

      // console.log(
      //   `Reported checkpoint slot: ${mostRecentCheckpointSlot}, block hash: ${mostRecentBlockHash} from Kupo.`
      // );
      // console.log(
      //   `Stored checkpoint slot: ${options.lastCheckpointSlot}, block hash: ${options.lastBlockHash} from DB.`
      // );

      // Handle chain rollback if any
      if (options.lastCheckpointSlot && mostRecentCheckpointSlot < options.lastCheckpointSlot) {
        console.log('Chain rollback detected. Deleting facts older than the most recent checkpoint slot.');
        // TODO maybe update would be better. Also, need to verify if this is the correct approach
        await deleteFactsOlderThanSlot(network, mostRecentCheckpointSlot);
      }

      // Process response
      const data = await response.json();
      const matches = KupoMatchesSchema.parse(data);
      const matchesCount = matches.length;
      const matchesByTx = groupMatchesByTx(matches);

      if (matchesCount > 0)
        console.log(
          `Found ${matchesCount} matches across ${matchesByTx.size} txs ${options?.queryParams?.created_before && options?.queryParams?.created_after ? `for slots ${options?.queryParams?.created_after} to ${options?.queryParams?.created_before}` : ''}`
        );

      return {
        lastBlockHash: mostRecentBlockHash,
        lastCheckpointSlot: mostRecentCheckpointSlot,
        transactions: matchesByTx
      };
    }
  } catch (error) {
    console.error('An error occurred while fetching transactions from Kupo', JSON.stringify(error, null, 2));
    return null;
  }
}

function groupMatchesByTx(matches: KupoMatch[]): KupoMatchesByTransaction {
  const resultMap: Map<string, KupoMatch[]> = new Map();

  matches.forEach((match) => {
    if (!resultMap.has(match.transaction_id)) {
      resultMap.set(match.transaction_id, []);
    }
    resultMap.get(match.transaction_id)!.push(match);
  });

  resultMap.forEach((value, key) => {
    resultMap.set(
      key,
      value.sort((a, b) => a.output_index - b.output_index)
    );
  });

  return resultMap;
}

// Fetch metadata and datums for each match and index them as Fact Statements
export async function parseAndIndexMatches(network: Network, matchesByTx: KupoMatchesByTransaction) {
  const feeds = await fetchFeeds(network);

  for (const [txId, matches] of matchesByTx) {
    const factStatements: Omit<
      FactStatement,
      'id' | 'participating_nodes' | 'sources' | 'content_signature' | 'collection_date'
    >[] = [];

    // TODO: Unsure if all slots will be the same or not
    if (matches.some((tx) => tx.created_at.slot_no !== matches[0].created_at.slot_no))
      throw new Error('Not all matches have the same created_at.slot_no');

    const metadata = await fetchTransactionMetadataFromKupo(txId, matches[0].created_at.slot_no, network);
    if (metadata === null) throw new Error('Failed to fetch metadata');

    // Parse transaction metadata without ToS
    const transactionMetadata = (
      OrcfaxToSSchema.safeParse(metadata[0].schema[1226].list[0]).success
        ? metadata[0].schema[1226].list.slice(1)
        : metadata[0].schema[1226].list
    ) as TransactionMetadata;

    // Fetch, decode, and parse each datum
    for (const [index, match] of matches.entries()) {
      if (match.datum_hash === null) throw new Error('Expected datum hash but found none');

      const datum = await fetchDatumFromKupo(match.datum_hash, network);
      if (datum === null) throw new Error('Expected datum hash but found none');

      // Index feed if unindexed
      if (!feeds.find((feed) => feed.feed_id === datum.feed_id)) {
        console.log(`Indexing ${network.name} feed: ${datum.feed_id}`);
        const feed = await createFeed({
          network: network.id,
          feed_id: datum.feed_id,
          type: datum.feed_type,
          name: datum.feed_name,
          version: parseInt(datum.feed_version),
          status: 'inactive',
          source_type: '',
          funding_type: '',
          calculation_method: '',
          heartbeat_interval: 0,
          deviation: 0
        });
        if (!feed) throw new Error('Failed to create feed');
        else feeds.push(feed);
      }
      const feedID = feeds.find((feed) => feed.feed_id === datum.feed_id)?.id;
      if (!feedID) throw new Error('Feed ID not found');

      const latestPolicy = network.policies[network.policies.length - 1];

      const fact_urn = transactionMetadata[index].map[0].v.string;
      const statement_hash = blake2b(new Uint8Array(32).length)
        .update(Buffer.from(`${datum.datum_hash}${fact_urn}`))
        .digest('hex');
      const arweaveFailureMessages = ['arweave tx not created', 'send to Arkly feature is not currently enabled'];
      const storage_urn = transactionMetadata[index].map[1].v.string;

      factStatements.push({
        network: network.id,
        policy: latestPolicy.id,
        fact_urn,
        storage_urn: arweaveFailureMessages.some((failureMessage) => storage_urn.includes(failureMessage))
          ? ''
          : storage_urn,
        feed: feedID,
        transaction_id: txId,
        block_hash: match.created_at.header_hash,
        slot: match.created_at.slot_no,
        address: match.address,
        value: datum.value,
        value_inverse: datum.inverse_value,
        validation_date: datum.validation_date,
        publication_date: slotToDate(match.created_at.slot_no, network),
        publication_cost: match.value.coins / 1_000_000,
        output_index: match.output_index,
        statement_hash,
        storage_cost: 0,
        is_archive_indexed: false,
        datum_hash: match.datum_hash
      });
    }

    // Index the transaction's parsed fact statements
    console.info(`Indexing ${factStatements.length} ${network.name} facts from tx: ${txId}...`);
    await indexFactStatements(factStatements);
  }
}

export async function fetchTransactionMetadataFromKupo(
  transactionId: string,
  slot: number,
  network: Network
): Promise<KupoMetadataResponse | null> {
  try {
    const response = await fetch(
      `${network.chain_index_base_url}/metadata/${slot}?${new URLSearchParams({ transaction_id: transactionId })}`
    );
    const data = await response.json();
    const metadata = KupoMetadataResponseSchema.parse(data);
    return metadata;
  } catch (error) {
    console.error('An error occurred while fetching transaction metadata from Kupo', JSON.stringify(error, null, 2));
    return null;
  }
}

export async function fetchDatumFromKupo(datumHash: string, network: Network): Promise<CurrencyPairDatum | null> {
  try {
    const response = await fetch(`${network.chain_index_base_url}/datums/${datumHash}`);
    const data = await response.json();
    const datumResponse = KupoDatumResponseSchema.parse(data);
    if (datumResponse.datum === null) throw new Error('Datum from Kupo response was null');
    const newDatum = decodeDatum(datumResponse.datum);
    return newDatum;
  } catch (error) {
    console.error('An error occurred while fetching datum from Kupo', JSON.stringify(error, null, 2));
    return null;
  }
}

function decodeDatum(serializedDatum: string): CurrencyPairDatum {
  const tags = {
    121: (val: unknown) => {
      // Assuming the value associated with tag 121 is an array
      if (Array.isArray(val)) {
        return val.map((item) => {
          if (item instanceof cbor.Tagged) {
            return item.value; // Recursively handle nested Tagged instances.
          }
          return item;
        });
      }
      return val;
    }
  };

  const decoded = cbor.decodeFirstSync(serializedDatum, { tags });
  const datum = DatumSchema.parse(decoded);

  // Process datum
  const feed_id = FeedIdSchema.parse(datum[0][0]);
  const feed_type = feed_id.split('/')[0];
  const feed_name = feed_id.split('/')[1];
  const feed_version = feed_id.split('/')[2];
  const base_ticker = feed_id.split('/')[1].split('-')[0];
  const quote_ticker = feed_id.split('/')[1].split('-')[1];
  const validation_date = new Date(datum[0][1]);
  const numerator = datum[0][2][0];
  const denominator = datum[0][2][1];
  const value = +(numerator / denominator);
  const formattedValue = value < 0.000001 ? +value.toFixed(10) : +value.toFixed(6);
  const inverse_value = +(1 / formattedValue);
  const datum_hash = decoded[0];

  return {
    feed_id,
    feed_type,
    feed_name,
    feed_version,
    base_ticker,
    quote_ticker,
    validation_date,
    value,
    datum_hash,
    inverse_value
  };
}
