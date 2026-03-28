import logging
from logging.handlers import RotatingFileHandler


def configure(log_file, max_bytes, backup_count):
    try:
        logging.basicConfig(
          handlers=[
            RotatingFileHandler(
              log_file,
              maxBytes=max_bytes,
              backupCount=backup_count
            )
          ],
          level=logging.DEBUG,
          format='%(asctime)s %(levelname)s %(message)s',
          force=True  # Force this handler to be used
        )
    except PermissionError:
        print(f'Cannot open log file ({log_file}). Logging is disabled.')

