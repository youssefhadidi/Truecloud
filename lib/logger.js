/** @format */

/**
 * Simple logger utility for server-side logging
 * Provides structured logging with timestamps and log levels
 */

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
};

const COLORS = {
  ERROR: '\x1b[31m', // Red
  WARN: '\x1b[33m', // Yellow
  INFO: '\x1b[36m', // Cyan
  DEBUG: '\x1b[90m', // Gray
  RESET: '\x1b[0m',
};

function formatTimestamp() {
  return new Date().toISOString();
}

function log(level, message, data = null) {
  const timestamp = formatTimestamp();
  const color = COLORS[level] || '';
  const reset = COLORS.RESET;

  let logMessage = `${color}[${timestamp}] [${level}]${reset} ${message}`;

  if (data) {
    console.log(logMessage);
    if (data instanceof Error) {
      console.error(`${color}Error Stack:${reset}`, data.stack);
      if (data.cause) {
        console.error(`${color}Caused by:${reset}`, data.cause);
      }
    } else {
      console.log(`${color}Data:${reset}`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
    }
  } else {
    console.log(logMessage);
  }
}

export const logger = {
  error: (message, data) => log(LOG_LEVELS.ERROR, message, data),
  warn: (message, data) => log(LOG_LEVELS.WARN, message, data),
  info: (message, data) => log(LOG_LEVELS.INFO, message, data),
  debug: (message, data) => log(LOG_LEVELS.DEBUG, message, data),

  // API request logger
  request: (method, url, data) => {
    log(LOG_LEVELS.INFO, `${method} ${url}`, data);
  },

  // API response logger
  response: (method, url, status, duration) => {
    const level = status >= 400 ? LOG_LEVELS.ERROR : status >= 300 ? LOG_LEVELS.WARN : LOG_LEVELS.INFO;
    log(level, `${method} ${url} - ${status} (${duration}ms)`);
  },
};

// Global error handlers for uncaught errors
if (typeof process !== 'undefined') {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception - Server may crash', error);
    // Give logger time to write before exiting
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', {
      reason: reason instanceof Error ? reason : new Error(String(reason)),
      promise,
    });
  });

  process.on('warning', (warning) => {
    logger.warn('Node.js Warning', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
    });
  });

  // Log startup
  logger.info('Logger initialized', {
    nodeVersion: process.version,
    platform: process.platform,
    env: process.env.NODE_ENV || 'development',
  });
}

export default logger;
