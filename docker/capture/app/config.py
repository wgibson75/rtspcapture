import json


def load(config_file):
    # Convert dictionary items to attributes
    class AttrifyDict(dict):

        def __init__(self, value):
            if isinstance(value, dict):
                for key in value:
                    self.__setitem__(key, value[key])

        def __setitem__(self, key, value):
            if isinstance(value, dict) and not isinstance(value, AttrifyDict):
                value = AttrifyDict(value)
            elif isinstance(value, list) and isinstance(value[0], dict):  # Support objects in a list
                value = [AttrifyDict(item) for item in value]
            super().__setitem__(key, value)

        def __getitem__(self, key):
            return self.get(key)

        __setattr__, __getattr__ = __setitem__, __getitem__

    with open(config_file) as json_config:
        config = json.load(json_config)
    return AttrifyDict(config)

