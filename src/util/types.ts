import { z } from 'zod';

export type Feed = z.infer<typeof FeedSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type KupoDatum = z.infer<typeof KupoDatumSchema>;
export type DBNetwork = z.infer<typeof DBNetworkSchema>;
export type KupoMatch = z.infer<typeof KupoMatchSchema>;
export type ActiveFeeds = z.infer<typeof ActiveFeedsSchema>;
export type NetworkSeed = z.infer<typeof NetworkSeedSchema>;
export type KupoMatches = z.infer<typeof KupoMatchesSchema>;
export type FactStatement = z.infer<typeof FactStatementSchema>;
export type KupoErrorResponse = z.infer<typeof KupoErrorResponseSchema>;
export type CurrencyPairDatum = z.infer<typeof CurrencyPairDatumSchema>;
export type KupoDatumResponse = z.infer<typeof KupoDatumResponseSchema>;
export type KupoRequestOptions = z.infer<typeof KupoRequestOptionsSchema>;
export type KupoMatchesResponse = z.infer<typeof KupoMatchesResponseSchema>;
export type TransactionMetadata = z.infer<typeof TransactionMetadataSchema>;
export type KupoMetadataResponse = z.infer<typeof KupoMetadataResponseSchema>;
export type KupoMatchesByTransaction = z.infer<typeof KupoMatchesByTransactionSchema>;

export const FactStatementSchema = z.object({
  id: z.string(),
  network: z.string(),
  feed: z.string(),
  policy: z.string(),
  fact_urn: z.string(),
  storage_urn: z.string(),
  transaction_id: z.string(),
  block_hash: z.string(),
  address: z.string(),
  slot: z.number(),
  output_index: z.number(),
  statement_hash: z.string(),
  value: z.coerce.number(),
  value_inverse: z.coerce.number(),
  publication_date: z.coerce.date(),
  validation_date: z.coerce.date(),
  publication_cost: z.number(),
  is_archived: z.boolean(),
  system_identifier: z.string(),
  system_version: z.string(),
  package_version: z.string(),
  storage_cost: z.number()
});

export const FeedSchema = z.object({
  id: z.string(),
  network: z.string(),
  feed_id: z.string(),
  type: z.string(),
  name: z.string(),
  version: z.number(),
  status: z.enum(['active', 'inactive']),
  source_type: z.enum(['CEX', 'DEX', '']),
  funding_type: z.enum(['showcase', 'paid', 'subsidized', '']),
  calculation_method: z.string(),
  heartbeat_interval: z.number(),
  deviation: z.number()
});

// Kupo Schemas

export const KupoErrorResponseSchema = z.object({
  hint: z.string()
});

export const KupoMatchSchema = z.object({
  transaction_index: z.number(),
  transaction_id: z.string(),
  output_index: z.number(),
  address: z.string(),
  value: z.object({
    coins: z.number(),
    assets: z.record(z.string(), z.number())
  }),
  datum_hash: z.nullable(z.string()),
  datum_type: z.string(),
  script_hash: z.nullable(z.string()),
  created_at: z.object({
    slot_no: z.number(),
    header_hash: z.string()
  }),
  spent_at: z.nullable(
    z.object({
      slot_no: z.number(),
      header_hash: z.string()
    })
  )
});

export const KupoMatchesSchema = z.array(KupoMatchSchema);

export const KupoMatchesByTransactionSchema = z.map(z.string(), KupoMatchesSchema);

export const KupoMatchesResponseSchema = z.object({
  lastBlockHash: z.string(),
  lastCheckpointSlot: z.number(),
  transactions: KupoMatchesByTransactionSchema
});

export const KupoRequestOptionsSchema = z.object({
  lastBlockHash: z
    .string()
    .optional()
    .transform((val) => (!val ? null : val)),
  lastCheckpointSlot: z
    .number()
    .optional()
    .transform((val) => (!val ? null : val)),
  queryParams: z
    .object({
      order: z.enum(['oldest_first', 'most_recent_first']).optional(),
      created_after: z.string().optional(),
      created_before: z.string().optional()
    })
    .optional()
});

export const KupoHeaderOptionsSchema = z.object({
  'If-None-Match': z.optional(z.string())
});

export const KupoDatumResponseSchema = z.object({
  datum: z.nullable(z.string())
});

export const KupoDatumSchema = z.object({
  transactionId: z.string(),
  blockHash: z.string(),
  slot: z.number(),

  feed_name: z.string(),
  urn: z.string(),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/), // ISO8601 format
  price_pair_1: z.tuple([z.string(), z.number()]),
  price_pair_2: z.tuple([z.string(), z.number()])
});

export const DatumMetadata = z.object({
  map: z.tuple([
    z.object({
      k: z.object({
        string: z.literal('id')
      }),
      v: z.object({
        string: z.string()
      })
    }),
    z.object({
      k: z.object({
        string: z.literal('src')
      }),
      v: z.object({
        string: z.string()
      })
    })
  ])
});

export const TransactionMetadataSchema = z.array(DatumMetadata);

export const OrcfaxToSSchema = z.object({
  string: z.union([
    z.literal('Use oracle data at your own risk: https://orcfax.io/tos/'),
    z.literal('Use oracle data at your own risk: https://orcfax.io/tos')
  ])
});

export const KupoMetadataSchema = z.array(z.unknown()).refine(
  (data) => {
    // Check if the first element is the ToS disclaimer or DatumMetadata object
    if (!OrcfaxToSSchema.safeParse(data[0]).success && !DatumMetadata.safeParse(data[0]).success) return false;

    // Check if all other elements are DatumMetadata objects
    for (let i = 1; i < data.length; i++) {
      if (!DatumMetadata.safeParse(data[i]).success) return false;
    }

    return true;
  },
  {
    message: 'Invalid Kupo metadata format. Expected an array of DatumMetadata objects.'
  }
);

export const KupoMetadataResponseSchema = z.array(
  z.object({
    hash: z.string(),
    raw: z.string(),
    schema: z.object({
      1226: z.object({
        list: KupoMetadataSchema
      })
    })
  })
);

export const DatumSchema = z.tuple([
  z.tuple([
    z.instanceof(Buffer).transform((val) => val.toString('utf-8')), // Versioned Feed ID
    z.number(), // Validation timestamp
    z.array(z.number()).length(2) // Numerator and denominator
  ]),
  z.union([
    z.tuple([
      z.instanceof(Buffer).transform((val) => val.toString('hex')) // Public key hash of the collector (signature)
    ]),
    z.tuple([
      z.number().optional(), // Slot number - kept for historical reasons
      z.instanceof(Buffer).transform((val) => val.toString('hex')) // Public key hash of the collector (signature)
    ])
  ])
]);

export const FeedIdSchema = z.string().regex(/^[^/]+\/[^/]+-[^/]+\/[^/]+$/, 'Invalid feed_id format');

export const CurrencyPairDatumSchema = z.object({
  feed_id: FeedIdSchema,
  feed_type: z.string(),
  feed_name: z.string(),
  feed_version: z.string(),
  base_ticker: z.string(),
  quote_ticker: z.string(),
  validation_date: z.date(),
  datum_hash: z.string(),
  value: z.number(),
  inverse_value: z.number()
});

// Schema for the full list of active feeds
export const ActiveFeedsSchema = z.object({
  meta: z.object({
    description: z.string(),
    version: z.string()
  }),
  feeds: z.array(
    z.object({
      pair: z.string(),
      label: z.string(),
      interval: z.number(),
      deviation: z.number(),
      source: z.enum(['cex', 'dex']),
      calculation: z.enum(['median', 'weighted mean']),
      status: z.enum(['showcase', 'subsidized', 'paid']),
      type: z.enum(['CER'])
    })
  )
});

export const DBNetworkSchema = z.object({
  id: z.string(),
  name: z.string(),
  fact_statement_pointer: z.string(),
  script_token: z.string(),
  arweave_wallet_address: z.string(),
  arweave_system_identifier: z.string(),
  cardano_smart_contract_address: z.string(),
  chain_index_base_url: z.string(),
  active_feeds_url: z.string(),
  block_explorer_base_url: z.string(),
  arweave_explorer_base_url: z.string(),
  last_block_hash: z.string(),
  last_checkpoint_slot: z.number(),
  zero_time: z.number(),
  zero_slot: z.number(),
  slot_length: z.number(),
  is_enabled: z.boolean()
});

export const PolicySchema = z.object({
  id: z.string(),
  network: z.union([z.string(), DBNetworkSchema]),
  policy_id: z.string(),
  starting_slot: z.number(),
  starting_block_hash: z.string(),
  starting_date: z.coerce.date()
});

export const NetworkSchema = DBNetworkSchema.extend({
  policies: z.array(PolicySchema)
});

export const NetworkSeedSchema = NetworkSchema.omit({ policies: true, id: true }).extend({
  ignore_policies: z.array(z.string())
});
