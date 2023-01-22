#!/usr/bin/env python3
import subprocess
import argparse
import logging
from logging.handlers import RotatingFileHandler
import shutil
import time
import json
import sys
import os
import re

#
# Script (to be run as a service) to continually check for
# CCTV recordings that are missing the MOOV atom and fix
# accordingly.
#
# Prerequisites:
#
# sudo apt update
# sudo apt install ffmpeg
# sudo apt install snapd
# sudo reboot
# sudo snap install core
# sudo snap install untrunc-anthwlock --edge
# sudo snap connect untrunc-anthwlock:removable-media
#
# NOTE: Last step required to use untrunc outside of $HOME.
#

LOG_FILE = 'checkmoov.log'
LOG_MAX_BYTES = 262144
LOG_BACKUP_COUNT = 2

# Period in seconds between checking all recordings
CHECK_INTERVAL_SECS = 60


class CaptureConfig:

    def __init__(self, config_file):
        try:
            with open(config_file) as f:
                self.data = json.load(f)
        except:
            sys.exit('Unable to open JSON configuration.')

    def getCaptureDir(self):
        try:
            return self.data['capture_dir']
        except KeyError:
            sys.exit('Unable to read capture configuration.')

    def getCameraNames(self):
        try:
            return [x['name'] for x in self.data['cameras']]
        except KeyError:
            sys.exit('Unable to read camera configuration.')

    def getLogFile(self):
        try:
            return self.data['checkmoov_log_file']
        except KeyError:
            sys.exit('Unable to read capture configuration.')

class CheckCamera:
    __MARKER_FILENAME = '.moov_check'
    __CMD_CHECK_MOOV = 'ffmpeg -v trace -i %s 2>&1 | grep "moov atom not found"'
    __CMD_FIX_MOOV = 'untrunc-anthwlock %s %s'
    __CMD_FASTSTART = 'ffmpeg -i %s -c:a copy -c:v copy -movflags faststart %s'
    __MOOV_FIX_FILENAME = '%s_fixed.mp4'
    __FASTSTART_FILENAME = '%s_faststart.mp4'

    def __init__(self, cam_dir):
        self.cam_dir = cam_dir
        self.good_file = None
        self.total_num_files = 0
        self.ignored_file = None
        os.chdir(cam_dir)

        files = self.__get_files_to_check()
        for f in files:
            logging.info('Checking: %s, size=%d [total: %s files]' % (f, os.path.getsize(f), self.total_num_files))
            if os.path.getsize(f) == 0:
                continue # Ignore empty files
            if self.__is_file_missing_moov(f):
                if not self.good_file:
                    self.good_file = self.__read_check_marker()
                if not self.good_file: # Need at least one good file to fix anything
                    logging.warning('Unable to fix %s. No good file to use.' % f)
                    continue
                if not self.__fix_moov(f):
                    logging.error('Failed to fix: %s' % f)
                    continue
            self.__write_check_marker(f) # Update the check marker for any good file

    def __get_all_files(self):
        files = [f for f in os.listdir('.') if re.match('^[a-zA-Z0-9_\-]+_\d+\.mp4$', f, re.IGNORECASE)]
        self.total_num_files = len(files)
        files.sort(key=lambda x: os.path.getmtime(x))
        self.__check_order_of_last_two_files(files)
        self.ignored_file = files.pop() # Remove the most recent recording (which might be active)
        return files

    def __check_order_of_last_two_files(self, files):
        if len(files) < 2: return
        last_digits = self.__get_filename_digits(files[-1])
        if not last_digits: return
        last_but_one_digits = self.__get_filename_digits(files[-2])
        if not last_but_one_digits: return
        last_num = int(last_digits)
        last_but_one_num = int(last_but_one_digits)
        wrap_num = int(len(last_digits) * '9')
        if (last_num < last_but_one_num and last_but_one_num != wrap_num) or \
           (last_num == wrap_num and last_but_one_num == 1):
           logging.info('Swapping order of %s with %s' % (files[-1], files[-2]))
           files[-1], files[-2] = files[-2], files[-1]

    def __get_filename_digits(self, filename): # Get a string comprising the digits in the filename
        m = re.match('^.*?(\d+)\.mp4$', filename)
        if m:
            return m.group(1)
        return None

    def __get_files_to_check(self):
        files = self.__get_all_files()
        marker = self.__read_check_marker()
        i = 0
        if not marker:
            # No check marker so return all files to check
            return files
        try:
            i = files.index(marker)
            return files[i+1:]
        except ValueError:
            logging.error('Failed to apply check marker %s [i=%d, num_files=%d]. Checking all files.' % (marker, i, len(files)))
            if self.ignored_file:
                logging.error('Ignored file: %s' % self.ignored_file)
            logging.error(','.join(files))
            return files

    def __is_file_missing_moov(self, file):
        process = subprocess.Popen(self.__CMD_CHECK_MOOV % file, shell=True, stdout=subprocess.PIPE)
        result = process.stdout.read()
        return True if result else False

    def __fix_moov(self, bad_file):
        # Step 1: Add the missing MOOV atom
        subprocess.call(self.__CMD_FIX_MOOV % (self.good_file, bad_file), shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        fixed_file = self.__MOOV_FIX_FILENAME % bad_file

        if not os.path.isfile(fixed_file):
            logging.error('Failed to create %s with MOOV atom.' % fixed_file)
            return False
        if os.path.getsize(fixed_file) == 0: # Sanity check
            logging.error('Size of %s is zero. Aborting fix.' % fixed_file)
            return False

        # Step 2: Move the MOOV atom to the beginning of the file
        faststart_file = self.__FASTSTART_FILENAME % bad_file
        if os.path.isfile(faststart_file): # Command will fail if output file already exists
            os.remove(faststart_file)
        subprocess.call(self.__CMD_FASTSTART % (fixed_file, faststart_file), shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)

        if not os.path.isfile(faststart_file):
            logging.error('Failed to create %s with faststart.' % faststart_file)
            os.remove(fixed_file) # Clean up fixed file
            return False

        # Step 3: Apply the last modified time from the original file
        last_access_time = os.path.getatime(bad_file)
        last_modified_time = os.path.getmtime(bad_file)
        os.utime(faststart_file, (last_access_time, last_modified_time))

        os.remove(fixed_file)
        shutil.move(faststart_file, bad_file)
        logging.info('Fixed: %s, ignored=%s' % (bad_file, self.ignored_file))
        return True

    def __write_check_marker(self, file):
        with open(self.__MARKER_FILENAME, 'w') as f:
            f.write(file)
            f.flush()
            os.fsync(f.fileno())

    def __read_check_marker(self):
        try:
            with open(self.__MARKER_FILENAME, 'r') as f:
                return f.read().strip()
        except:
            return None

class CheckAllCameras:

    def __init__(self, config):
        self.capture_dir = config.getCaptureDir()
        self.camera_names = config.getCameraNames()

    def run(self):
        for cam in self.camera_names:
            cam_dir = os.path.join(self.capture_dir, cam)
            CheckCamera(cam_dir)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('config_file', help='CCTV JSON configuration file.')
    parser.add_argument('-i', '--check-interval', nargs='?', type=int, default=CHECK_INTERVAL_SECS,
        help='Interval in seconds between checking all recordings.')
    args = parser.parse_args()

    config = CaptureConfig(args.config_file)

    try:
        logging.basicConfig(
          handlers=[
            RotatingFileHandler(
              os.path.join(os.path.dirname(os.path.realpath(__file__)), config.getLogFile()),
              maxBytes=LOG_MAX_BYTES,
              backupCount=LOG_BACKUP_COUNT
            )
          ],
          level=logging.DEBUG,
          format='%(asctime)s %(message)s'
        )
    except PermissionError:
        print('Cannot open log file. Logging is disabled.')

    logging.info('Starting...')

    scanner = CheckAllCameras(config)
    while True:
        time.sleep(args.check_interval)
        scanner.run()

if __name__ == "__main__":
    main()
