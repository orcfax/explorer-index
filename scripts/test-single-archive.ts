/**
 * Fetch and index a single unarchived fact with verbose logging.
 * Useful for debugging endpoint issues.
 *
 * Usage:
 *   npx tsx scripts/test-single-archive.ts                # picks the first unarchived fact
 *   npx tsx scripts/test-single-archive.ts <fact_urn>     # targets a specific fact
 */

import 'dotenv/config';
import { z } from 'zod';
import PocketBase from 'pocketbase';
import * as zlib from 'zlib';
import * as tar from 'tar-stream';
import { promisify } from 'util';
import { pipeline, Readable } from 'stream';
import { FactStatementSchema, NetworkSchema, PolicySchema } from '../src/util/types.js';

const MAINNET_NETWORK_ID = 'l1ppggh4ls079w9';
const pipelineAsync = promisify(pipeline);

async function main() {
  const { DB_HOST, DB_EMAIL, DB_PASSWORD, PRIMARY_ARWEAVE_ENDPOINT, SECONDARY_ARWEAVE_ENDPOINT } = process.env;

  if (!DB_HOST || !DB_EMAIL || !DB_PASSWORD) {
    console.error('Missing required env vars: DB_HOST, DB_EMAIL, DB_PASSWORD');
    process.exit(1);
  }

  console.log(`PRIMARY_ARWEAVE_ENDPOINT: ${PRIMARY_ARWEAVE_ENDPOINT ?? '(not set)'}`);
  console.log(`SECONDARY_ARWEAVE_ENDPOINT: ${SECONDARY_ARWEAVE_ENDPOINT ?? '(not set)'}`);

  const db = new PocketBase(DB_HOST);
  await db.collection('_superusers').authWithPassword(DB_EMAIL, DB_PASSWORD);
  console.log('Authenticated with PocketBase.\n');

  // Find the target fact
  const targetUrn = process.argv[2];
  let filter = `network = "${MAINNET_NETWORK_ID}" && is_archive_indexed = false && storage_urn != ""`;
  if (targetUrn) {
    filter += ` && fact_urn = "${targetUrn}"`;
  }

  const records = await db.collection('facts').getList(1, 1, { filter, sort: '-validation_date' });
  if (records.items.length === 0) {
    console.error(targetUrn ? `Fact not found: ${targetUrn}` : 'No unarchived facts found.');
    process.exit(1);
  }

  const fact = FactStatementSchema.parse(records.items[0]);
  console.log(`Fact URN:     ${fact.fact_urn}`);
  console.log(`Storage URN:  ${fact.storage_urn}`);
  console.log(`Tx ID:        ${fact.storage_urn.slice(12)}`);
  console.log();

  // Try fetching from each endpoint
  const endpoints: { name: string; url: string | undefined }[] = [
    { name: 'PRIMARY', url: PRIMARY_ARWEAVE_ENDPOINT },
    { name: 'SECONDARY', url: SECONDARY_ARWEAVE_ENDPOINT }
  ];

  let archiveBuffer: ArrayBuffer | null = null;
  let successEndpoint: string | null = null;

  for (const { name, url } of endpoints) {
    if (!url) {
      console.log(`--- ${name}: not configured, skipping ---\n`);
      continue;
    }

    const fetchUrl = `${url.replace(/\/+$/, '')}/${fact.storage_urn.slice(12)}`;
    console.log(`--- ${name} ---`);
    console.log(`URL: ${fetchUrl}`);

    try {
      const response = await fetch(fetchUrl);
      console.log(`Status:       ${response.status} ${response.statusText}`);
      console.log(`Content-Type: ${response.headers.get('content-type')}`);
      console.log(`Content-Len:  ${response.headers.get('content-length')}`);

      if (!response.ok) {
        const body = await response.text().catch(() => '(unreadable)');
        console.log(`Response body: ${body.slice(0, 500)}`);
        console.log();
        continue;
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || (!contentType.includes('x-tar') && !contentType.includes('gzip'))) {
        console.log(`Unexpected content type, skipping.`);
        console.log();
        continue;
      }

      archiveBuffer = await response.arrayBuffer();
      successEndpoint = name;
      console.log(`Downloaded ${archiveBuffer.byteLength} bytes.`);
      console.log();
      break;
    } catch (e) {
      console.log(`Fetch error: ${e instanceof Error ? e.message : e}`);
      console.log();
    }
  }

  if (!archiveBuffer || !successEndpoint) {
    console.error('Both endpoints failed. Nothing to index.');
    process.exit(1);
  }

  // Extract tarball
  console.log(`--- Extracting archive (via ${successEndpoint}) ---`);
  const files = await extractTarball(archiveBuffer);
  console.log(`Extracted ${files.length} file(s):`);
  for (const f of files) {
    console.log(`  ${f.name} (${f.extension})`);
  }
  console.log();

  // Parse archive contents
  console.log('--- Parsing archive contents ---');

  const validationFile = files.find((f) => f.name.includes('validation-'));
  if (validationFile) {
    console.log(`Validation file: ${validationFile.name}`);
  } else {
    console.error('No validation file found in archive.');
  }

  const messageFiles = files.filter((f) => f.name.includes('message-'));
  console.log(`Message files:   ${messageFiles.length}`);
  for (const m of messageFiles) {
    console.log(`  ${m.name}`);
  }
  console.log();

  // Get network for full indexing
  const networkRecords = await db.collection('networks').getFullList({
    filter: `id = "${MAINNET_NETWORK_ID}"`,
    expand: 'policies_via_network'
  });
  const record = networkRecords[0];
  const policies = record.expand?.policies_via_network
    ? z.array(PolicySchema).parse(record.expand.policies_via_network)
    : [];
  const network = NetworkSchema.parse({ ...record, policies });

  // Now run the real indexArchives on this single fact
  console.log('--- Running indexArchives ---');
  const { indexArchives } = await import('../src/util/archives.js');
  await indexArchives(network, [fact]);

  // Verify result
  const updated = await db.collection('facts').getOne(fact.id);
  console.log();
  console.log(`--- Result ---`);
  console.log(`is_archive_indexed: ${updated.is_archive_indexed}`);
  console.log(`content_signature:  ${updated.content_signature}`);
  console.log(`collection_date:    ${updated.collection_date}`);
  console.log(`sources:            ${JSON.stringify(updated.sources)}`);
  console.log(`nodes:              ${JSON.stringify(updated.participating_nodes)}`);
}

interface ExtractedFile {
  name: string;
  extension: string;
  content: unknown;
}

async function extractTarball(tarball: ArrayBuffer): Promise<ExtractedFile[]> {
  const buffer = Buffer.from(tarball);
  const stream = Readable.from(buffer);
  const extract = tar.extract();
  const files: ExtractedFile[] = [];

  extract.on('entry', (header, entryStream, next) => {
    let content = '';
    entryStream.on('data', (chunk: Buffer) => (content += chunk.toString()));
    entryStream.on('end', () => {
      const ext = header.name.split('.').pop()?.toUpperCase() ?? 'UNKNOWN';
      if (header.name.endsWith('.txt') || header.name.endsWith('.json')) {
        files.push({
          name: header.name,
          extension: ext,
          content: header.name.endsWith('.json') ? JSON.parse(content) : content
        });
      }
      next();
    });
    entryStream.resume();
  });

  const gunzip = zlib.createGunzip();
  await pipelineAsync(stream, gunzip, extract);
  return files;
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
