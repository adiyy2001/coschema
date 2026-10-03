export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

export function describeError(error: unknown): LogFields {
  if (error instanceof Error) return { error: error.message, errorName: error.name };
  return { error: String(error) };
}

export interface LoggerOptions {
  readonly write: (line: string) => void;
  readonly now: () => Date;
  readonly level?: LogLevel;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_ORDER[options.level ?? 'info'];
  const log =
    (level: LogLevel) =>
    (message: string, fields?: LogFields): void => {
      if (LEVEL_ORDER[level] < threshold) return;
      options.write(
        JSON.stringify({ time: options.now().toISOString(), level, message, ...fields }),
      );
    };
  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
