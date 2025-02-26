import 'dotenv/config';
import { getAllFactStatementsWithNoDatumHash, isIndexEmpty, updateFactStatement } from './db.js';
import { logError } from './util/logger.js';
import { initIndexSyncCronJob } from './cron.js';
import { fetchMatchesFromKupo, getNetworks, populateIndex, updateFactStatementsWithDatumHashes } from './kupo.js';

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

  const mainnet = networks.find((n) => n.name === 'Mainnet');
  let page = 1;
  const firstRes = await getAllFactStatementsWithNoDatumHash(mainnet!, page, 100);
  const totalPages = firstRes.totalPages;

  while (page <= totalPages) {
    const res = await getAllFactStatementsWithNoDatumHash(mainnet!, page, 100);
    const transactionIds = res.facts.map((f) => [f.transaction_id, f.slot]);
    // console.log(transactionIds);
    // await updateFactStatementsWithDatumHashes(mainnet!, res.facts);
    // console.log(res.facts.map((f) => f.slot));
    const createdAfter = res.facts[0].slot;
    const createdBefore = res.facts[res.facts.length - 1].slot;

    console.log(`Created after: ${createdAfter}`);
    console.log(`Created before: ${createdBefore}`);
    const matches = await fetchMatchesFromKupo(mainnet!, {
      lastBlockHash: null,
      lastCheckpointSlot: null,
      queryParams: {
        order: 'oldest_first',
        created_after: createdAfter,
        created_before: createdBefore
      }
    });

    const transactions = matches?.transactions;
    if (!transactions) throw new Error('No transactions found');
    console.log(matches);

    // for (const fact of res.facts) {
    //   const objs = transactions.get(fact.transaction_id);
    //   if (!objs) {
    //     console.log(`SKIP - no objects found for transaction ${fact.transaction_id} with slot ${fact.slot}`);
    //     continue;
    //   }
    //   const obj = objs.find((o) => o.output_index === fact.output_index && o.transaction_id === fact.transaction_id);
    //   if (!obj || !obj.datum_hash) throw new Error('No object found with datum hash');
    //   await updateFactStatement(fact.id, { datum_hash: obj.datum_hash! });
    // }

    page++;
  }

  // Setup Cron Jobs
  // initIndexSyncCronJob(networks);
} catch (error) {
  logError('Unhandled exception', error);
}
