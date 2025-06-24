import {
  Node,
  Source,
  Network,
  ArchiveData,
  ArchivedFile,
  FactStatement,
  FactSourceMessage,
  ValidationFileSchema,
  FactSourceMessageSchema
} from './types.js';
import pLimit from 'p-limit';
import * as zlib from 'zlib';
import { promisify } from 'util';
import * as tar from 'tar-stream';
import { logError } from './logger.js';
import { pipeline, Readable } from 'stream';
import { createNode, createSource, getAllNodes, getAllSources, updateFactStatement, updateSource } from '../db.js';

export async function indexArchives(network: Network, facts: FactStatement[]) {
  if (facts.length < 1) return;

  console.info(`\n* * Indexing batch of archives from Arweave for ${network.name}...`);

  const cachedNodes = await getAllNodes(network);
  const cachedSources = await getAllSources(network);

  // Set a concurrency limit. Adjust as needed based on performance and resource constraints.
  const limit = pLimit(5);

  // Define the task for a single fact
  const processFact = async (fact: FactStatement, index: number) => {
    console.info(`Indexing ${index + 1} of ${facts.length} archives, Fact URN: ${fact.fact_urn}`);

    if (!fact.storage_urn) {
      console.info(`No archive found for ${fact.fact_urn}`);
      return null;
    }

    const files = await getArchiveFiles(fact);
    if (!files) return null;

    // Parse the archive files
    const [nodes, sources] = await Promise.all([
      getNodeDetailsFromArchive(network, files, cachedNodes),
      getSourceDetailsFromArchive(network, files, cachedSources)
    ]);
    const factDetails = getFactDetailsFromArchive(files);

    // Index fact details
    await updateFactStatement(fact.id, {
      ...factDetails.fact,
      sources: sources.map((source) => source.id),
      participating_nodes: nodes.map((node) => node.id),
      is_archive_indexed: true
    });

    return fact.fact_urn;
  };

  // Create tasks with the concurrency limit
  const tasks = facts.map((fact, index) => limit(() => processFact(fact, index)));

  // Run all tasks
  const results = await Promise.all(tasks);

  // Filter out null results
  const successfulArchives = results.filter(Boolean);

  console.info(`* * Indexed archives for ${successfulArchives.length} of ${facts.length} facts.`);
}

export async function getArchiveFiles(
  fact: Pick<FactStatement, 'fact_urn' | 'storage_urn'>
): Promise<ArchivedFile[] | null> {
  try {
    if (!fact.storage_urn) return [];

    const archivedBagResponse = await fetch(`https://arweave.net/${fact.storage_urn.slice(12)}`, {});

    if (!archivedBagResponse.body || !archivedBagResponse.ok) {
      throw new Error('Unable to retrieve fact statement archival package');
    }

    const contentType = archivedBagResponse.headers.get('content-type');
    if (!contentType || (!contentType.includes('x-tar') && !contentType.includes('gzip'))) {
      throw new Error(`Unexpected content type: ${contentType}`);
    }

    const archivedBagArrayBuffer = await archivedBagResponse.arrayBuffer();
    const archivedBagTarball = archivedBagArrayBuffer; // new Uint8Array(archivedBagArrayBuffer);
    const files = await getArchivedFilesFromTarball(archivedBagTarball);

    return files;
  } catch (e) {
    logError('Something went wrong fetching the archive: ', JSON.stringify(e, null, 2));
    return null;
  }
}

async function getArchivedFilesFromTarball(tarball: ArrayBuffer): Promise<ArchivedFile[]> {
  const pipelineAsync = promisify(pipeline);
  const tarballBuffer = Buffer.from(tarball);
  const stream = Readable.from(tarballBuffer);
  const extract = tar.extract();
  const files: ArchivedFile[] = [];

  extract.on('entry', (header, stream, next) => {
    let content = '';
    stream.on('data', (chunk) => (content += chunk.toString()));
    stream.on('end', () => {
      if (header.name.endsWith('.txt') || header.name.endsWith('.json')) {
        const fileExtension = header.name.split('.').pop() ?? 'Unknown';
        const segments = header.name.split('/').filter((segment: string) => segment !== '');
        const fileName = segments[segments.length - 1];

        files.push({
          name: header.name,
          fileName,
          extension: fileExtension.toUpperCase(),
          content: header.name.endsWith('.json') ? JSON.parse(content) : content
        });
      }
      next();
    });
    stream.resume();
  });

  try {
    const gunzip = zlib.createGunzip();
    gunzip.on('error', (error) => {
      console.error('Error during decompression:', error);
    });
    await pipelineAsync(stream, gunzip, extract);
  } catch (err) {
    console.error('Pipeline failed', err);
    throw err;
  }

  return files;
}

async function getNodeDetailsFromArchive(network: Network, files: ArchivedFile[], nodesCache: Node[]): Promise<Node[]> {
  try {
    const nodes: Node[] = [];

    // Parse Validation file
    const validationFile = files.find((file) => file.fileName.includes('validation-'));
    if (!validationFile) throw new Error('Validation file not found in archive');
    const validationFileContents = ValidationFileSchema.parse(validationFile.content);

    const node: Omit<Node, 'id'> = {
      network: network.id,
      node_urn: validationFileContents.isBasedOn.identifier,
      type: 'federated',
      status: 'active',
      name: validationFileContents.contributor.name,
      address_locality: validationFileContents.contributor.locationCreated.address.addressLocality,
      address_region: validationFileContents.contributor.locationCreated.address.addressRegion,
      geo_coordinates: validationFileContents.contributor.locationCreated.address.geo
    };
    const hasCachedNode = nodesCache.find(
      (cached) => cached.node_urn === node.node_urn && cached.network === network.id
    );
    if (!hasCachedNode) {
      const newNode = await createNode(node);
      if (newNode) {
        console.info(`Created new ${network.name} node: ${newNode.node_urn}`);
        nodes.push(newNode);
        nodesCache.push(newNode);
      }
    } else nodes.push(hasCachedNode);

    return nodes;
  } catch (e) {
    logError('Error parsing source details from archive', e);
    return [];
  }
}

async function getSourceDetailsFromArchive(
  network: Network,
  files: ArchivedFile[],
  sourcesCache: Source[]
): Promise<Source[]> {
  try {
    // Get message file names for source matching
    const sources: Source[] = [];
    const messageFiles = files.filter(({ fileName }) => fileName.includes('message-'));

    // Build the list of sources in the archive
    const archiveSources = messageFiles.reduce((acc, sourceMessage) => {
      const match = sourceMessage.fileName.match(/-([\w]+?)(?:\.tick_|-\d{4}-\d{2}-\d{2}T)/);
      if (!match)
        throw new Error(
          `Error retrieving source name from file name for network ${network.name}, file: ${sourceMessage.fileName}`
        );
      acc.set(match[1], FactSourceMessageSchema.parse(sourceMessage.content));
      return acc;
    }, new Map<string, FactSourceMessage>());

    // Create sources for any missing source names in cache
    for (const [name, source] of archiveSources) {
      const sourceType = source.isBasedOn.additionalType === 'Central Exchange Data' ? 'CEX API' : 'DEX LP';
      const senderUrl = new URL(source.sender);
      const sender = source.sender.includes('https://') ? `${senderUrl.protocol}//${senderUrl.host}` : source.sender;

      // First check for exact match (same recipient)
      const hasCachedSource = sourcesCache.find(
        (cached) => cached.recipient === source.recipient && cached.network === network.id
      );

      if (!hasCachedSource) {
        // Check for source with same name, type, and sender but different recipient
        const existingSource = sourcesCache.find(
          (cached) =>
            cached.name === name &&
            cached.type === sourceType &&
            cached.sender === sender &&
            cached.network === network.id &&
            cached.recipient !== source.recipient
        );

        if (existingSource) {
          // Update existing source to inactive
          await updateSource({
            id: existingSource.id,
            status: 'inactive'
          });

          // Create new source with properties from existing source
          const newSource = await createSource(network, {
            network: network.id,
            name,
            type: sourceType,
            sender,
            recipient: source.recipient,
            status: 'active',
            website: existingSource.website,
            image_path: existingSource.image_path,
            background_color: existingSource.background_color
          });

          if (newSource) {
            console.info(
              `Updated ${network.name} source: ${newSource.recipient} (replaced ${existingSource.recipient})`
            );
            sources.push(newSource);
            sourcesCache.push(newSource);
          }
        } else {
          // Create completely new source
          const newSource = await createSource(network, {
            network: network.id,
            name,
            type: sourceType,
            sender,
            recipient: source.recipient,
            status: 'active'
          });

          if (newSource) {
            console.info(`Created new ${network.name} source: ${newSource.recipient}`);
            sources.push(newSource);
            sourcesCache.push(newSource);
          }
        }
      } else {
        sources.push(hasCachedSource);
      }
    }

    return sources;
  } catch (e) {
    logError('Error parsing source details from archive', e);
    return [];
  }
}

function getFactDetailsFromArchive(files: ArchivedFile[]): Pick<ArchiveData, 'fact'> {
  // Parse Validation file
  const validationFile = files.find((file) => file.fileName.includes('validation-'));
  if (!validationFile) throw new Error('Validation file not found in archive');
  const contents = ValidationFileSchema.parse(validationFile.content);

  return {
    fact: {
      content_signature: contents.additionalType[0].recordedIn.description.sha256,
      collection_date: new Date(contents.additionalType[0].recordedIn.hasPart[0].text)
    }
  };
}

// function parseBagInfoTextFile(files: ArchivedFile[]) {
//   const bagInfoFile = files.find((file) => file.fileName.includes('bag-info.txt'));
//   if (!bagInfoFile || typeof bagInfoFile.content !== 'string') throw new Error('Bag info file not found in archive');

//   // Convert text file contents into an object
//   const data: Record<string, string> = bagInfoFile.content.split('\n').reduce(
//     (acc, line) => {
//       const [key, ...valueParts] = line.split(': ');
//       if (key && valueParts.length > 0) {
//         acc[key] = valueParts.join(': ').trim();
//       }
//       return acc;
//     },
//     {} as Record<string, string>
//   );

//   // Validate and parse the data
//   const result = BagInfoSchema.safeParse(data);

//   if (!result.success) {
//     console.error('Validation errors:', result.error.format());
//     throw new Error('Invalid data in the text file');
//   }

//   return result.data;
// }

// function getEpochDays(facts: FactStatement[]): string[] {
//   // Helper function to create a Date object at the start of a period
//   const getStartOf = (period: 'year' | 'month' | 'week' | 'day' | 'hour', utcDate: Date) => {
//     const startDate = new Date(utcDate); // Clone the original date
//     switch (period) {
//       case 'year':
//         startDate.setUTCMonth(0, 1); // January 1
//         startDate.setUTCHours(0, 0, 0, 0);
//         break;
//       case 'month':
//         startDate.setUTCDate(1); // First day of the month
//         startDate.setUTCHours(0, 0, 0, 0);
//         break;
//       case 'week':
//         startDate.setUTCDate(startDate.getUTCDate() - startDate.getUTCDay()); // Go back to the previous Sunday
//         startDate.setUTCHours(0, 0, 0, 0);
//         break;
//       case 'day':
//         startDate.setUTCHours(0, 0, 0, 0); // Start of the day
//         break;
//       case 'hour':
//         startDate.setUTCMinutes(0, 0, 0); // Start of the hour
//         break;
//     }
//     return startDate;
//   };

//   facts.sort((a, b) => a.validation_date.getTime() - b.validation_date.getTime());

//   const startDate = facts[0].validation_date;
//   const startEpoch: Record<string, number> = {
//     'Epoch-Year': Math.floor(getStartOf('year', startDate).getTime() / 1000),
//     'Epoch-Month': Math.floor(getStartOf('month', startDate).getTime() / 1000),
//     'Epoch-Week': Math.floor(getStartOf('week', startDate).getTime() / 1000),
//     'Epoch-Day': Math.floor(getStartOf('day', startDate).getTime() / 1000),
//     'Epoch-Hour': Math.floor(getStartOf('hour', startDate).getTime() / 1000)
//   };

//   const endDate = facts[facts.length - 1].validation_date;
//   const endEpoch: Record<string, number> = {
//     'Epoch-Year': Math.floor(getStartOf('year', endDate).getTime() / 1000),
//     'Epoch-Month': Math.floor(getStartOf('month', endDate).getTime() / 1000),
//     'Epoch-Week': Math.floor(getStartOf('week', endDate).getTime() / 1000),
//     'Epoch-Day': Math.floor(getStartOf('day', endDate).getTime() / 1000),
//     'Epoch-Hour': Math.floor(getStartOf('hour', endDate).getTime() / 1000)
//   };

//   // Get Epoch Days Between
//   const epochDays: string[] = [];
//   const oneDayInSeconds = 86400; // Number of seconds in a day

//   for (let epoch = startEpoch['Epoch-Day']; epoch <= endEpoch['Epoch-Day']; epoch += oneDayInSeconds) {
//     epochDays.push(epoch.toString());
//   }

//   return epochDays;
// }
