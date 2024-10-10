import winston from 'winston';

// Setup environment variables
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
if (!DISCORD_WEBHOOK_URL) throw new Error('DISCORD_WEBHOOK_URL environment variable is not set');
const NODE_ENV = process.env.NODE_ENV;
if (!NODE_ENV) throw new Error('NODE_ENV environment variable is not set');

// Set up the Winston logger
const logger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

// Generic error logging function
export async function logError(message: string, error?: unknown) {
  // Format the error message
  let formattedError = '';
  if (error instanceof Error) {
    formattedError = error.stack || error.message;
  } else if (typeof error === 'string') {
    formattedError = error;
  } else if (error) {
    formattedError = JSON.stringify(error, null, 2);
  }

  // Construct the log message
  const logMessage = `${message}${formattedError ? `: ${formattedError}` : ''}`;

  // Log the message using Winston
  logger.error(logMessage);

  // Send the log message to Discord
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
    await sendMessageToDiscord(logMessage);
  }
}

async function sendMessageToDiscord(message: string) {
  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: `${process.env.NODE_ENV.toUpperCase()}: ${message}`
      })
    });

    if (!res.ok) throw new Error(`Failed to send error to Discord webhook: ${res.statusText}`);
  } catch (error) {
    logger.error(`Failed to send error to Discord webhook: ${error}`);
  }
}
