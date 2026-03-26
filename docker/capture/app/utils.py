import json
import logging
from logging.handlers import RotatingFileHandler
import os


def load_config(config_file):
    # Convert dictionary items to attributes
    class AttrifyDict(dict):

        def __init__(self, value):
            if isinstance(value, dict):
                for key in value:
                    self.__setitem__(key, value[key])

        def __setitem__(self, key, value):
            if isinstance(value, dict) and not isinstance(value, AttrifyDict):
                value = AttrifyDict(value)
            elif isinstance(value, list):  # Support objects in a list
                value = [AttrifyDict(item) for item in value]
            super().__setitem__(key, value)

        def __getitem__(self, key):
            return self.get(key)

        __setattr__, __getattr__ = __setitem__, __getitem__

    with open(config_file) as json_config:
        config = json.load(json_config)
    return AttrifyDict(config)


def configure_logging(logger, log_file, max_bytes, backup_count):
    logger.setLevel(logging.DEBUG)

    os.makedirs(os.path.dirname(log_file), 0o777, True)

    handler = RotatingFileHandler(
        log_file,
        maxBytes=max_bytes,
        backupCount=backup_count
    )
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
