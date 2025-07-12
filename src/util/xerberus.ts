import { XerberusBulkRiskRating, XerberusBulkRiskRatingAPIResponseSchema } from './types.js';
import { logError } from './logger.js';
import { getAllAssets } from '../db.js';
import PocketBase from 'pocketbase';

// Setup DB connection
const db = new PocketBase(process.env.DB_HOST);
await db.collection('_superusers').authWithPassword(process.env.DB_EMAIL, process.env.DB_PASSWORD);

// Get supported assets from Xerberus API
export async function getXerberusSupportedAssets(): Promise<string[]> {
  try {
    const bulkRatings = await getXerberusBulkRiskRatings();
    if (!bulkRatings) return [];

    return bulkRatings.response.data.scores.map((score) => score.fingerprint);
  } catch (e) {
    logError('Failed to fetch supported assets from Xerberus API', e);
    return [];
  }
}

// Update hasXerberusRiskRating field for all assets
export async function updateXerberusRiskRatingSupport(): Promise<void> {
  try {
    // Get all assets from DB
    const assets = await getAllAssets();
    if (!assets.length) {
      console.info('No assets found in database');
      return;
    }

    // Get supported assets from Xerberus
    const supportedFingerprints = await getXerberusSupportedAssets();
    if (!supportedFingerprints.length) {
      console.info('No supported assets found from Xerberus API');
      return;
    }

    // Update each asset's hasXerberusRiskRating field
    let updatedCount = 0;
    for (const asset of assets) {
      const isSupported = asset.fingerprint ? supportedFingerprints.includes(asset.fingerprint) : false;

      // Only update if the support status has changed
      if (asset.hasXerberusRiskRating !== isSupported) {
        try {
          await db.collection('assets').update(asset.id, {
            hasXerberusRiskRating: isSupported
          });
          updatedCount++;
        } catch (error) {
          logError(`Failed to update Xerberus support status for asset ${asset.ticker}`, error);
        }
      }
    }

    console.info(`Updated Xerberus risk rating support for ${updatedCount} assets`);
  } catch (error) {
    logError('Failed to update Xerberus risk rating support', error);
  }
}

// Get bulk risk ratings for all supported assets
export async function getXerberusBulkRiskRatings(): Promise<XerberusBulkRiskRating | null> {
  try {
    const apiKey = process.env.PRIVATE_XERBERUS_API_KEY;
    const userEmail = process.env.PRIVATE_XERBERUS_USER_EMAIL;
    if (!apiKey || !userEmail) throw new Error('Missing Xerberus API key');

    const endpoint = 'https://api.xerberus.io/public/v1/risk/scores';
    const res = await fetch(endpoint, {
      headers: {
        'x-api-key': apiKey,
        'x-user-email': userEmail
      }
    });
    if (!res.ok) {
      throw new Error(`Bad response from Xerberus API`);
    }

    const xSignedBy = res.headers.get('X-SIGNED-BY');
    const xSignature = res.headers.get('X-SIGNATURE');
    if (!xSignedBy || !xSignature) throw new Error(`Missing Xerberus API signature headers`);

    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));

    return {
      response: XerberusBulkRiskRatingAPIResponseSchema.parse(data),
      xSignedBy,
      xSignature,
      endpoint: endpoint
    };
  } catch (e) {
    logError('Failed to fetch bulk risk ratings from Xerberus API', e);
    return null;
  }
}
