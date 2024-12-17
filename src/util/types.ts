import { z } from 'zod';

// Database Collection Schemas
export type Node = z.infer<typeof NodeSchema>;
export type Feed = z.infer<typeof FeedSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type DBNetwork = z.infer<typeof DBNetworkSchema>;
export type NetworkSeed = z.infer<typeof NetworkSeedSchema>;
export type FactStatement = z.infer<typeof FactStatementSchema>;

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

export const NodeSchema = z.object({
  id: z.string(),
  node_urn: z.string(),
  network: z.union([z.string(), DBNetworkSchema]),
  status: z.enum(['active', 'inactive']),
  type: z.enum(['federated', 'decentralized', 'itn']),
  name: z.string(),
  address_locality: z.string().optional(),
  address_region: z.string().optional(),
  geo_coordinates: z.string().optional()
});

export const SourceSchema = z.object({
  id: z.string(),
  network: z.string(),
  identifier: z.string(),
  recipient: z.string(),
  sender: z.string(),
  name: z.string(),
  type: z.enum(['CEX API', 'DEX LP']),
  description: z.string().optional(),
  website: z.string().optional(),
  image_path: z.string().optional(),
  background_color: z.string().optional(),
  // For CEX sources, assetPairValue is used. For DEX sources base and quote will be used.
  baseAssetValue: z.number().optional(),
  quoteAssetValue: z.number().optional(),
  assetPairValue: z.number().optional()
});

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
  participating_nodes: z.union([z.array(z.string()), z.array(NodeSchema)]),
  storage_cost: z.number(),
  sources: z.union([z.array(z.string()), z.array(SourceSchema)]),
  content_signature: z.string(),
  collection_date: z.coerce
    .date()
    .nullable()
    .catch(() => {
      return null;
    }),
  is_archive_indexed: z.boolean().nullable()
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

// Active Feeds Schemas - Used for fetching active feeds from GitHub cer-feeds.json
// Schema for the full list of active feeds
export type ActiveFeeds = z.infer<typeof ActiveFeedsSchema>;

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

// Kupo Schemas
export type KupoDatum = z.infer<typeof KupoDatumSchema>;
export type KupoMatch = z.infer<typeof KupoMatchSchema>;
export type KupoMatches = z.infer<typeof KupoMatchesSchema>;
export type KupoErrorResponse = z.infer<typeof KupoErrorResponseSchema>;
export type CurrencyPairDatum = z.infer<typeof CurrencyPairDatumSchema>;
export type KupoDatumResponse = z.infer<typeof KupoDatumResponseSchema>;
export type KupoRequestOptions = z.infer<typeof KupoRequestOptionsSchema>;
export type KupoMatchesResponse = z.infer<typeof KupoMatchesResponseSchema>;
export type TransactionMetadata = z.infer<typeof TransactionMetadataSchema>;
export type KupoMetadataResponse = z.infer<typeof KupoMetadataResponseSchema>;
export type KupoMatchesByTransaction = z.infer<typeof KupoMatchesByTransactionSchema>;

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

// Arweave and Archive Schemas
export type Tag = z.infer<typeof TagSchema>;
export type TagFilters = z.infer<typeof TagFiltersSchema>;
export type ArweaveEdge = z.infer<typeof ArweaveEdgeSchema>;
export type ArchiveData = z.infer<typeof ArchiveDataSchema>;
export type ValidationFile = z.infer<typeof ValidationFileSchema>;
export type ArweaveResponse = z.infer<typeof ArweaveResponseSchema>;
export type DEXValidationFile = z.infer<typeof DEXValidationFileSchema>;
export type FactSourceMessage = z.infer<typeof FactSourceMessageSchema>;
export type CEXValidationFile = z.infer<typeof CEXValidationFileSchema>;
export type ArweaveTransaction = z.infer<typeof ArweaveTransactionSchema>;
export type ArweavePageResponse = z.infer<typeof ArweavePageResponseSchema>;
export type ArweaveTransactionsResponse = z.infer<typeof ArweaveTransactionsResponseSchema>;

export interface ArchivedFile {
  name: string;
  fileName: string;
  extension: string;
  content: string | object;
}

const TagSchema = z.object({
  name: z.enum([
    'System Identifier',
    'System Name',
    'System Version',
    'Package Version',
    'Feed Name',
    'Feed Type',
    'Fact Datum URN',
    'Fact Datum Identifier',
    'Fact Description',
    'Fact Datum Value',
    'Fact Validation Date',
    'Source Organization',
    'Content-Type'
  ]),
  value: z.string()
});

const TagFiltersSchema = z.array(z.object({ name: z.string(), values: z.array(z.string()) }));

export const ArweaveEdgeSchema = z.object({
  cursor: z.string(),
  node: z.object({
    id: z.string(),
    tags: z.array(TagSchema)
  })
});

export const ArweaveResponseSchema = z.object({
  transactions: z.object({
    pageInfo: z.object({
      hasNextPage: z.boolean()
    }),
    edges: z.array(ArweaveEdgeSchema)
  })
});

export const ArweavePageResponseSchema = z.object({
  data: ArweaveResponseSchema.nullable(),
  nextPageCursor: z.string().nullable(),
  isRateLimited: z.boolean()
});

export const ArchiveDataSchema = z.object({
  node: NodeSchema.omit({ id: true, network: true }),
  sources: z.array(SourceSchema),
  fact: FactStatementSchema.pick({
    content_signature: true,
    collection_date: true
  }),
  is_archive_indexed: z.boolean().nullable()
});

export const ArweaveTransactionSchema = z.object({
  cursor: z.string(),
  node: z.object({
    id: z.string(),
    tags: z.array(TagSchema)
  })
});

export const ArweaveTransactionsResponseSchema = z.object({
  transactions: z.object({
    pageInfo: z.object({
      hasNextPage: z.boolean()
    }),
    edges: z.array(ArweaveTransactionSchema)
  })
});

export const FactSourceMessageSchema = z.object({
  '@context': z.literal('https://schema.org'),
  type: z.literal('Message'),
  name: z.string(),
  isBasedOn: z.object({
    '@type': z.literal('MediaObject'),
    name: z.literal('Exchange data'),
    additionalType: z.union([z.literal('Central Exchange Data'), z.literal('Decentralized Exchange Data')]),
    description: z.string()
  }),
  sender: z.string(),
  recipient: z.string(),
  identifier: z.string(),
  dateReceived: z.string()
});

export const CollectionEventSchema = z.object({
  '@type': z.literal('Event'),
  description: z.string(),
  startDate: z.string(),
  recordedIn: z.object({
    '@type': z.literal('CreativeWork'),
    description: z.object({
      '@type': z.literal('TextObject'),
      comment: z.string(),
      sha256: z.string()
    }),
    hasPart: z.tuple([
      z.object({
        '@type': z.literal('CreativeWork'),
        description: z.literal('collecting timestamp'),
        text: z.string()
      }),
      z.object({
        '@type': z.literal('CreativeWork'),
        description: z.string().startsWith('data points for'),
        text: z.array(z.string())
      }),
      z.object({
        '@type': z.literal('CreativeWork'),
        description: z.literal('node identifier (uuid)'),
        text: z.string()
      })
    ])
  })
});

export const ValidationFileSchema = z.object({
  '@context': z.literal('https://schema.org'),
  type: z.literal('MediaObject'),
  identifier: z.string(),
  isBasedOn: z.object({
    '@type': z.literal('MediaObject'),
    name: z.string(),
    identifier: z.string()
  }),
  contributor: z.object({
    '@type': z.literal('Organization'),
    name: z.string(),
    locationCreated: z.object({
      address: z.object({
        '@type': z.literal('PostalAddress'),
        addressLocality: z.string(),
        addressRegion: z.string(),
        geo: z.string()
      })
    })
  }),
  additionalType: z.tuple([CollectionEventSchema, z.unknown()])
});

export const DEXValidationFileSchema = ValidationFileSchema.extend({
  additionalType: z.tuple([
    CollectionEventSchema,
    z.object({
      '@type': z.literal('Event'),
      description: z.string().startsWith('average price is determined by dividing total volume of'),
      startDate: z.string(),
      about: z.object({
        '@type': z.literal('Observation'),
        measurementMethod: z.tuple([z.string().startsWith('volume/liquidity average sum(valueReference[1])')]),
        value: z.coerce.number(),
        valueReference: z.array(
          z
            .string()
            .transform((str) => JSON.parse(str))
            .pipe(z.array(z.number()))
        )
      })
    })
  ])
});

export const CEXValidationFileSchema = ValidationFileSchema.extend({
  additionalType: z.tuple([
    CollectionEventSchema,
    z.object({
      '@type': z.literal('Event'),
      description: z.literal('selection of median value from collected node data'),
      startDate: z.string(),
      about: z.object({
        '@type': z.literal('StatisticalVariable'),
        measurementMethod: z.literal(
          'median calculation of a minimum of three data sources from the selected collector node'
        ),
        measurementTechnique: z.array(
          z.object({
            '@type': z.literal('PropertyValue'),
            name: z.string(),
            value: z.string()
          })
        ),
        variableMeasured: z.object({
          '@type': z.literal('Observation'),
          measurementMethod: z.literal('median value'),
          value: z.coerce.number(),
          valueReference: z.array(z.coerce.number())
        })
      })
    })
  ])
});

export const BagInfoSchema = z.object({
  'Bag-Software-Agent': z.string(),
  'Bagging-Date': z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: 'Invalid date format'
  }),
  'Epoch-Day': z.string().transform(Number),
  'Epoch-Hour': z.string().transform(Number),
  'Epoch-Month': z.string().transform(Number),
  'Epoch-Week': z.string().transform(Number),
  'Epoch-Year': z.string().transform(Number),
  'Fact-Datum-Identifier': z.string().uuid(),
  'Fact-Datum-URN': z.string(),
  'Fact-Datum-Value': z.string().transform(Number),
  'Fact-Description': z.string(),
  'Fact-Validation-Date': z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: 'Invalid date format'
  }),
  'Feed-ID': z.string(),
  'Feed-Name': z.string(),
  'Feed-Type': z.string(),
  'Package-Version': z.string().transform(Number),
  'Packaging-Agent': z.string(),
  'Payload-Oxum': z.string(),
  'Source-Organization': z.string(),
  'System-Identifier': z.string(),
  'System-Name': z.string(),
  'System-Version': z.string(),
  'Unix-Time': z.string().transform(Number)
});
