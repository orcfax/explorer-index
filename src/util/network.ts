import { DBNetwork, NetworkSeed } from './types';

export const NetworkSeeds: NetworkSeed[] = [
  {
    name: 'Preview',
    fact_statement_pointer: '0690081bc113f74e04640ea78a87d88abbd2f18831c44c4064524230',
    script_token: '000de140',
    arweave_wallet_address: '6KymaAPWd3JNyMT0B7EPYij4TWxehhMrzRD8qifCSLs',
    arweave_system_identifier: 'urn:orcfax:system:00000000-0000-0000-0000-000000000000',
    cardano_smart_contract_address: 'addr_test1vr6lx0dk534vvv93js4n0qnqs0y9mkxtursdwc7ed7szeqgur3u54',
    chain_index_base_url: process.env.PREVIEW_CHAIN_INDEX_BASE_URL,
    active_feeds_url: 'https://raw.githubusercontent.com/orcfax/cer-feeds/main/feeds/preview/cer-feeds.json',
    block_explorer_base_url: 'https://preview.cexplorer.io',
    arweave_explorer_base_url: 'https://arweave.net',
    zero_time: 1666656000000,
    zero_slot: 0,
    slot_length: 1000,
    last_block_hash: '',
    last_checkpoint_slot: 0,
    is_enabled: true,
    ignore_policies: [
      '900d528f3c1864a1376db1afc065c9b293a2235f39b00a674badf00d',
      '900d528f3c1864a1376db1afc065c9b293a2235f39b00a67455a6724'
    ]
  },
  {
    name: 'Mainnet',
    fact_statement_pointer: '8793893b5dda6a513ba63c80e9d7b2d4f108060c11979bfc7d863ff0',
    script_token: '000de140',
    arweave_wallet_address: 'JPsW_QzlLTrCdK-m8iOhSsV8fTiC0vAoxD9SIQUqzLI',
    arweave_system_identifier: 'urn:orcfax:system:f0122760-64f8-445d-bd28-9c93a6391f89',
    cardano_smart_contract_address: 'addr1vy7p9anntmu8v4w9kfaua5lc9rv9059z0lfq7tx6rr4l97c9w4kcq',
    chain_index_base_url: process.env.MAINNET_CHAIN_INDEX_BASE_URL,
    active_feeds_url: 'https://raw.githubusercontent.com/orcfax/cer-feeds/main/feeds/mainnet/cer-feeds.json',
    block_explorer_base_url: 'https://cexplorer.io',
    arweave_explorer_base_url: 'https://arweave.net',
    zero_time: 1596059091000,
    zero_slot: 4492800,
    slot_length: 1000,
    last_block_hash: '',
    last_checkpoint_slot: 0,
    is_enabled: true,
    ignore_policies: []
  }
];

// Network Utility Functions ⤵️

export function slotToDate(slot: number, network: Omit<DBNetwork, 'id'>): Date {
  const msAfterBegin = (slot - network.zero_slot) * network.slot_length;
  return new Date(network.zero_time + msAfterBegin);
}

export function dateToSlot(slotDate: Date, network: Omit<DBNetwork, 'id'>): number {
  const unixTime = slotDate.getTime();
  const timePassed = unixTime - network.zero_time;
  const slotsPassed = Math.floor(timePassed / network.slot_length);
  return slotsPassed + network.zero_slot;
}

export function slotAfterTimePeriod(
  slot: number,
  timePeriod: 'day' | 'week' | 'month',
  network: Omit<DBNetwork, 'id'>
): number {
  let milliseconds: number;

  switch (timePeriod) {
    case 'day':
      milliseconds = 24 * 60 * 60 * 1000; // one day in milliseconds
      break;
    case 'week':
      milliseconds = 7 * 24 * 60 * 60 * 1000; // one week in milliseconds
      break;
    case 'month':
      milliseconds = 30 * 24 * 60 * 60 * 1000; // one month in milliseconds (approx.)
      break;
    default:
      throw new Error('Invalid time period specified');
  }

  const additionalSlots = Math.floor(milliseconds / network.slot_length);
  return slot + additionalSlots;
}
