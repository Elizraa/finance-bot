import dotenv from 'dotenv';
dotenv.config();

import pino from 'pino';
import pinoRoll from 'pino-roll';

const fileStream = await pinoRoll({
  file: 'logs/app',
  frequency: 'daily',
  mkdir: true,
  size: '20m',
  dateFormat: 'yyyy-MM-dd',
});

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'debug',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  pino.multistream([
    { stream: fileStream, level: 'info' },
    {
      stream: pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }),
      level: 'debug',
    },
  ]),
);

export const log = {
  info: (msg, meta = {}) => logger.info(meta, msg),
  warn: (msg, meta = {}) => logger.warn(meta, msg),
  error: (msg, meta = {}) => logger.error(meta, msg),
  debug: (msg, meta = {}) => logger.debug(meta, msg),
  user: (userId, msg, meta = {}) => logger.info({ userId, ...meta }, msg),
  userError: (userId, msg, meta = {}) => logger.error({ userId, ...meta }, msg),
};
