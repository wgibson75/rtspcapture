#!/usr/bin/env python3
import os
import sys
import argparse
import re

CONFIG_FILE = "config.json"
SCRIPT_NAME = os.path.basename(__file__)

def strip_password(config, password):
    lines = []
    try:
        with open(config) as f:
            for line in f:
                lines.append(re.sub(r'^(\s*[\"\']password[\"\']\s*:\s*[\"\']).*?([\"\'])', r'\1%s\2' % password, line))
    except PermissionError:
        sys.exit('Unable to read %s' % config)
    try:
        with open(config, "w") as f:
            for line in lines:
                f.write(line)
    except PermissionError:
        sys.exit('Unable to write %s' % config)

def main():
    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description='Sets the password for all cameras in the JSON configuration file to the supplied\n' +
                    'password. This is useful for stripping out the passwords before committing any\n' +
                    'update to the JSON configuration file. By default, the configuration file\n' +
                    '%s will be modified.\n' % CONFIG_FILE)
    parser.add_argument('-s', '--strip', help='strip all passwords and replace with empty strings', action='store_const', const=True, default=False)
    parser.add_argument('-c', '--config-file', help='JSON configuration file', default=CONFIG_FILE)
    parser.add_argument('password', nargs='?', help='Password to set')
    args = parser.parse_args()

    if args.strip:
        args.password and print('Ignoring supplied password.')
        args.password = ''
    elif not args.password:
        sys.exit('Please specify a password.')
    os.path.isfile(args.config_file) or sys.exit('File not found: %s' % args.config_file)

    strip_password(args.config_file, args.password)

if __name__ == "__main__":
    main()