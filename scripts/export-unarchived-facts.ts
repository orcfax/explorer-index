/**
 * Export all mainnet facts that have is_archive_indexed = false
 * and a non-empty storage_urn, ordered by validation_date.
 *
 * Usage: npx tsx export-unarchived-facts.ts
 *
 * Requires DB_HOST, DB_EMAIL, DB_PASSWORD env vars (reads from .env via dotenv).
 */

import 'dotenv/config';
import PocketBase from 'pocketbase';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const MAINNET_NETWORK_ID = 'l1ppggh4ls079w9';
const OUTPUT_FILE = resolve(import.meta.dirname ?? '.', 'unarchived-facts.json');

async function main() {
  const { DB_HOST, DB_EMAIL, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_EMAIL || !DB_PASSWORD) {
    console.error('Missing required env vars: DB_HOST, DB_EMAIL, DB_PASSWORD');
    process.exit(1);
  }

  const db = new PocketBase(DB_HOST);
  await db.collection('_superusers').authWithPassword(DB_EMAIL, DB_PASSWORD);
  console.log('Authenticated with PocketBase.');

  const filter = `network = "${MAINNET_NETWORK_ID}" && is_archive_indexed = false && storage_urn != ""`;
  console.log(`Querying facts with filter: ${filter}`);

  const facts = await db.collection('facts').getFullList({
    filter,
    sort: 'validation_date'
  });

  console.log(`Found ${facts.length} matching facts.`);

  // --- Build feed ID → name lookup ---
  const feeds = await db.collection('feeds').getFullList();
  const feedNameById = new Map(feeds.map((f) => [f.id, f.name]));

  // --- Build summary ---
  const byDay: Record<string, number> = {};
  const byFeed: Record<string, number> = {};
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const fact of facts) {
    const date = fact.validation_date?.slice(0, 10); // YYYY-MM-DD
    if (date) {
      byDay[date] = (byDay[date] ?? 0) + 1;
      if (!earliest || date < earliest) earliest = date;
      if (!latest || date > latest) latest = date;
    }
    const feedName = feedNameById.get(fact.feed) ?? fact.feed ?? 'unknown';
    byFeed[feedName] = (byFeed[feedName] ?? 0) + 1;
  }

  const sortedByDay = Object.fromEntries(Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)));

  const output = {
    summary: {
      total: facts.length,
      date_range: { earliest, latest },
      by_day: sortedByDay,
      by_feed: byFeed,
      exported_at: new Date().toISOString()
    },
    facts
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Written to ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
