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

UNTRUNC_BINARY       = 'untrunc'
FFMPEG_BINARY        = 'ffmpeg'
DATA_COPY_CHUNK_SIZE = 1024 * 1024 # Copy fixed data in 1Mb chunks

LOG_MAX_BYTES    = 262144
LOG_BACKUP_COUNT = 2

logger = logging.getLogger('checkmoov_log')

class CaptureConfig:

    def __init__(self, config_file):
        try:
            with open(config_file) as f:
                self.data = json.load(f)
        except:
            sys.exit('Unable to open JSON configuration.')

        try:
            self.capture_dir    = os.path.join(self.data['root_path'],
                                               self.data['capture_dir'])
            self.camera_names   = [x['name'] for x in self.data['cameras']]
            self.log_file       = os.path.join(self.data['root_path'],
                                               self.data['logs_dir'],
                                               self.data['checkmoov_log'])
            self.check_interval = self.data['checkmoov_interval_secs']
        except KeyError:
            sys.exit('Unable to read capture configuration.')

    def getCaptureDir(self):
        return self.capture_dir

    def getCameraNames(self):
        return self.camera_names

    def getLogFile(self):
        return self.log_file

    def getCheckInterval(self):
        return self.check_interval

class CheckCamera:
    __MARKER_FILENAME = '.moov_check'
    __CMD_CHECK_MOOV = FFMPEG_BINARY + ' -v trace -i %s 2>&1 | egrep -i "moov atom not found|invalid"'
    __CMD_FIX_MOOV = UNTRUNC_BINARY + ' %s %s'
    __CMD_FASTSTART = FFMPEG_BINARY + ' -i %s -c:a copy -c:v copy -movflags faststart %s'
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
            if os.path.getsize(f) == 0:
                continue # Ignore empty files
            logging.info(f'Checking: {f}, size={os.path.getsize(f)} [total: {self.total_num_files} files]')
            if self.__is_file_missing_moov(f):
                if not self.good_file:
                    self.good_file = self.__read_check_marker()
                if not self.good_file: # Need at least one good file to fix anything
                    logging.warning(f'Unable to fix {f}. No good file to use.')
                    continue
                if not self.__fix_moov(f):
                    logging.error(f'Failed to fix: {f}')
                    continue
            self.__write_check_marker(f) # Update the check marker for any good file

    def __get_all_files(self):
        files = [f for f in os.listdir('.') if re.match('^[a-zA-Z0-9_\-]+_\d+\.mp4$', f, re.IGNORECASE)]
        self.total_num_files = len(files)
        files.sort(key=lambda x: os.path.getmtime(x))
        self.__check_order_of_last_two_files(files)
        if len(files):
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
           logging.info(f'Swapping order of {files[-1]} with {files[-2]}')
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
            logging.error(f'Failed to apply check marker {marker} [i={i}, num_files={len(files)}]. Checking all files.')
            if self.ignored_file:
                logging.error(f'Ignored file: {self.ignored_file}')
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
            logging.error(f'Failed to create {fixed_file} with MOOV atom.')
            return False

        bad_file_size   = os.path.getsize(bad_file)
        fixed_file_size = os.path.getsize(fixed_file)

        if fixed_file_size == 0: # Sanity check
            logging.error(f'Size of {fixed_file} is zero. Aborting fix.')
            return False

        if fixed_file_size < bad_file_size:
            logging.warning(f'Fixed file is smaller than original: {fixed_file}, {bad_file}')
            logging.warning(f'Fixed vs original file sizes: {fixed_file_size} bytes, {bad_file_size} bytes ({bad_file_size - fixed_file_size} bytes lost)')

        # Step 2: Move the MOOV atom to the beginning of the file to create a fast start file
        faststart_file = self.__FASTSTART_FILENAME % bad_file
        if os.path.isfile(faststart_file): # Command will fail if output file already exists
            os.remove(faststart_file)
        subprocess.call(self.__CMD_FASTSTART % (fixed_file, faststart_file), shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)

        os.remove(fixed_file) # Clean up the initial fixed file

        if not os.path.isfile(faststart_file):
            logging.error(f'Failed to create {faststart_file} with faststart.')
            return False

        # Step 3: Maintain the creation time and the last modified time of the original file with fixed data
        last_access_time   = os.path.getatime(bad_file)
        last_modified_time = os.path.getmtime(bad_file)

        # It is important to maintain the original file creation time and last modified time
        # so that we can determine the duration of any video file efficiently by subtracting
        # the creation time from the last modified time. So truncate the original bad file
        # to zero bytes and replace its contents with data from the fast start file.
        with open(faststart_file, 'rb') as src:
            with open(bad_file, 'ab') as dest:
                dest.truncate(0)
                while True:
                    data = src.read(DATA_COPY_CHUNK_SIZE)
                    if not data:
                        break
                    dest.write(data)

        os.remove(faststart_file) # Clean up the fast start file

        # Then re-apply the original last modified time (and last access time)
        os.utime(bad_file, (last_access_time, last_modified_time))

        fixed_file_size = os.path.getsize(bad_file)
        logging.info(f'Fixed: {bad_file} (size: {fixed_file_size}), ignored={self.ignored_file}')
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
            if not os.path.isdir(cam_dir):
                continue
            CheckCamera(cam_dir)

def configure_logging(config):
    log_file = config.getLogFile()

    if not os.path.exists(os.path.dirname(log_file)):
        os.makedirs(os.path.dirname(log_file))

    try:
        logging.basicConfig(
          handlers=[
            RotatingFileHandler(
              log_file,
              maxBytes=LOG_MAX_BYTES,
              backupCount=LOG_BACKUP_COUNT
            )
          ],
          level=logging.DEBUG,
          format='%(asctime)s %(levelname)s %(message)s'
        )
    except PermissionError:
        print(f'Cannot open log file ({log_file}). Logging is disabled.')

def checkmoov(config):
    logging.info('Starting...')

    scanner = CheckAllCameras(config)
    while True:
        time.sleep(config.getCheckInterval())
        scanner.run()

def main():
    if not shutil.which(UNTRUNC_BINARY):
        sys.exit('Cannot find %s' % UNTRUNC_BINARY)
    if not shutil.which(FFMPEG_BINARY):
        sys.exit('Cannot find %s' % FFMPEG_BINARY)

    parser = argparse.ArgumentParser()
    parser.add_argument('config_file', help='CCTV JSON configuration file.')
    args = parser.parse_args()

    config = CaptureConfig(args.config_file)
    configure_logging(config)

    try:
        checkmoov(config)
    except Exception:
        logger.exception('Fatal error in main loop')

if __name__ == "__main__":
    main()
