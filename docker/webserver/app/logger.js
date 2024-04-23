const { createLogger, format, transports } = require('winston');
const winston_daily_rotate_file            = require('winston-daily-rotate-file');
const path                                 = require('path');

const config = require('./config');

const LOG_FILE = 'webserver-%DATE%.log'; // Log filename

module.exports = {
    logger: null,

    init: function() {
        let { combine, printf, timestamp, splat } = format;

        let logFormat = printf(({ level, message, timestamp }) => {
          return `${timestamp} [${level}] ${message}`;
        });

        let now = new Date();
        this.logger = createLogger({
          level: 'info',
          format: combine(splat(), timestamp(), logFormat),
          transports: [
              new transports.Console(),
              new (winston_daily_rotate_file)({
                  filename: path.join(config.get('root_path'), config.get('logs_dir'), LOG_FILE),
                  datePattern: 'yyyy-MM-DD',
                  maxFiles: '7d'
              })
          ]
        });
    },

    info: function() {
        return this.logger.info.apply(null, arguments);
    },

    warn: function() {
        return this.logger.warn.apply(null, arguments);
    },

    error: function() {
        return this.logger.error.apply(null, arguments);
    }
};