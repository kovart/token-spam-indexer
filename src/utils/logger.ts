import path from "path";
import { DATA_FOLDER_PATH } from "../constants";
import pino from "pino";

const LOG_FILE_PATH = path.resolve(DATA_FOLDER_PATH, './logs/main.log');

export function getLogger(params: { colorize: boolean; file: boolean; console: boolean }) {
  const targets: any[] = [];

  if (params.file) {
    targets.push({
      target: 'pino/file',
      options: {
        colorize: params.colorize,
        destination: LOG_FILE_PATH,
        mkdir: true
      },
      level: 'trace',
    });
  }
  if (params.console) {
    targets.push({
      target: 'pino-pretty',
      options: {
        colorize: params.colorize
      },
      level: 'trace',
    });
  }

  const logger = pino(
    pino.transport({
      targets: targets,
    }),
  );

  logger.level = 'trace';

  return logger;
}

const Logger = getLogger({
  colorize: true,
  file: true,
  console: true,
});

export default Logger;
