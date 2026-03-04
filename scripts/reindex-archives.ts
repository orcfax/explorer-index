/**
 * Re-index all unarchived mainnet facts with no time cutoff.
 * Fetches archives from PRIMARY_ARWEAVE_ENDPOINT (with fallback to secondary)
 * and updates the DB.
 *
 * Usage: npx tsx scripts/reindex-archives.ts
 *
 * Requires DB_HOST, DB_EMAIL, DB_PASSWORD, PRIMARY_ARWEAVE_ENDPOINT env vars (reads from .env via dotenv).
 */

import 'dotenv/config';
import { z } from 'zod';
import PocketBase from 'pocketbase';
import { FactStatementSchema, NetworkSchema, PolicySchema } from '../src/util/types.js';
import { indexArchives } from '../src/util/archives.js';

const MAINNET_NETWORK_ID = 'l1ppggh4ls079w9';

async function main() {
  const { DB_HOST, DB_EMAIL, DB_PASSWORD, PRIMARY_ARWEAVE_ENDPOINT } = process.env;
  if (!DB_HOST || !DB_EMAIL || !DB_PASSWORD) {
    console.error('Missing required env vars: DB_HOST, DB_EMAIL, DB_PASSWORD');
    process.exit(1);
  }
  if (!PRIMARY_ARWEAVE_ENDPOINT) {
    console.error('Missing required env var: PRIMARY_ARWEAVE_ENDPOINT');
    process.exit(1);
  }

  const db = new PocketBase(DB_HOST);
  await db.collection('_superusers').authWithPassword(DB_EMAIL, DB_PASSWORD);
  console.log('Authenticated with PocketBase.');

  // Get the Mainnet network record
  const networkRecords = await db.collection('networks').getFullList({
    filter: `id = "${MAINNET_NETWORK_ID}"`,
    expand: 'policies_via_network'
  });

  if (networkRecords.length === 0) {
    console.error('Mainnet network not found');
    process.exit(1);
  }

  const record = networkRecords[0];
  const policies = record.expand?.policies_via_network
    ? z.array(PolicySchema).parse(record.expand.policies_via_network)
    : [];
  const network = NetworkSchema.parse({ ...record, policies });

  // Query ALL unarchived facts — no time cutoff
  const filter = `network = "${MAINNET_NETWORK_ID}" && is_archive_indexed = false && storage_urn != ""`;
  console.log(`Querying unarchived facts...`);

  const records = await db.collection('facts').getFullList({ filter, sort: 'validation_date' });
  const facts = z.array(FactStatementSchema).parse(records);

  console.log(`Found ${facts.length} unarchived facts.`);
  if (facts.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  await indexArchives(network, facts);
  console.log('Done.');
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
