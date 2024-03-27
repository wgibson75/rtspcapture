#!/usr/bin/env python3
import argparse
import os
import sys
import subprocess
import time
import math
import re
import glob
import shutil
import json
import logging
from logging.handlers import RotatingFileHandler
from types import SimpleNamespace
from datetime import datetime,timezone
from abc import ABC, abstractmethod
from onvif import ONVIFCamera

logger = logging.getLogger('capture_log')
onvif_wsdl_defs = None

# Number of seconds to elapse with no update for capture to be considered dead
update_dead_time_secs = None

class CommandProc:
    def __init__(self, cmd):
        self.cmd = cmd
        logger.info('Invoking command: %s' % ' '.join(cmd))
        self.process = subprocess.Popen(self.cmd)

    def is_alive(self):
        return True if (self.process.poll() == None) else False

    def kill(self):
        self.process.terminate()

class StreamCapture(ABC):
    def __init__(self, cam, stream):
        self.name, self.username, self.password, self.ip, self.port, self.stream, self.capture_proc = \
            cam.name, cam.username, cam.password, cam.ip, cam.port, stream, None

        # Create top level camera capture directory
        if not os.path.isdir(self.name): os.mkdir(self.name, 0o777)

    @abstractmethod
    def is_alive(self):
        if ((self.capture_proc == None) or not self.capture_proc.is_alive()):
            return False
        return True

    @abstractmethod
    def _start(self):
        raise NotImplementedError()

    def kill(self):
        if (self.capture_proc != None):
            self.capture_proc.kill()
            self.capture_proc = None

    def restart(self):
        self.kill()
        self._start()

    def get_map_arg(self):
        # Only capture the video stream unless config specifies mapping
        return ('-map', '0:0') if (self.stream.map == None) else ('-map', self.stream.map)


class LiveStreamCapture(StreamCapture):
    def __init__(self, cam, stream):
        super().__init__(cam, stream)

        # Create output directory for live streaming
        out_dir = '%s/%s' % (self.name, stream.name)
        if os.path.isdir(out_dir):
            logger.info('Removing directory: %s' % out_dir)
            shutil.rmtree(out_dir)
        if not os.path.isdir(out_dir):
            os.mkdir(out_dir, 0o777)

        self.out_playlist = '%s/live.m3u8' % out_dir
        self._start()

    def _start(self):
        cmd = []
        cmd.append(('ffmpeg'))
        cmd.extend(('-fflags', 'nobuffer'))
        cmd.extend(('-rtsp_transport', 'tcp'))
        cmd.extend(('-i', 'rtsp://%s:%s@%s:%d%s' % (self.username, self.password, self.ip, self.port, self.stream.path)))
        cmd.extend(('-c:v', 'copy'))     # Copy the video stream
        if (self.stream.include_audio):
            cmd.extend(('-c:a', 'copy')) # Copy the audio stream if required
        cmd.extend(super().get_map_arg())
        cmd.extend(('-f', 'hls'))
        cmd.extend(('-hls_time', '1'))
        cmd.extend(('-hls_list_size', '10'))
        cmd.extend(('-hls_flags', 'delete_segments'))
        cmd.extend(('-hls_segment_type', 'fmp4'))
        if self.stream.aspect != None:
            cmd.extend(('-aspect', self.stream.aspect))
        if (self.stream.xargs != None):  # Add any extra arguments (ensuring we split on whitespace)
            cmd.extend((self.stream.xargs.split()))
        cmd.append((self.out_playlist))

        self.capture_proc = CommandProc(cmd)

    def is_alive(self):
        if not super().is_alive():
            return False
        if not os.path.isfile(self.out_playlist):
            return False
        secs_since_last_update = int(datetime.now(timezone.utc).timestamp() - os.lstat(self.out_playlist).st_mtime)
        if (secs_since_last_update > update_dead_time_secs):
            return False
        return True

class RecordStreamCapture(StreamCapture):
    def __init__(self, cam, stream, seg_time, seg_wrap):
        super().__init__(cam, stream)
        self.seg_time, self.seg_wrap = seg_time, seg_wrap

        # Setup output format and search pattern for recording segments
        self.out_record_format = self.name + '/' + self.name + '_%0' + str(int(math.log10(self.seg_wrap)) + 1) + 'd.mp4'
        self.out_record_search = re.sub('%0\d+d', '*', self.out_record_format)

        self._start()

    def _start(self):
        cmd = []
        cmd.append(('ffmpeg'))
        cmd.extend(('-rtsp_transport', 'tcp')) # Prevent use of UDP to avoid packet loss
        cmd.extend(('-i', 'rtsp://%s:%s@%s:%d%s' % (self.username, self.password, self.ip, self.port, self.stream.path)))
        cmd.extend(('-c', 'copy')) # Take an exact copy of the input stream
        cmd.extend(super().get_map_arg())
        cmd.extend(('-f', 'segment'))
        cmd.extend(('-segment_time', '%d' % self.seg_time))
        cmd.extend(('-segment_wrap', '%d' % self.seg_wrap))
        cmd.extend(('-segment_start_number', '%d' % self.get_segment_start_num()))
        cmd.extend(('-reset_timestamps', '1'))
        if self.stream.vtag != None:
            cmd.extend(('-tag:v', self.stream.vtag))
        if self.stream.aspect != None:
            cmd.extend(('-aspect', self.stream.aspect))
        cmd.append((self.out_record_format))

        self.capture_proc = CommandProc(cmd)

    def is_alive(self):
        if not super().is_alive():
            return False
        files = sorted(glob.glob(self.out_record_search), key=os.path.getmtime, reverse=True)
        if (len(files) == 0):
            return False
        secs_since_last_update = int(datetime.now(timezone.utc).timestamp() - os.lstat(files[0]).st_mtime)
        if (secs_since_last_update > update_dead_time_secs):
            return False
        return True

    def get_segment_start_num(self):
        files = sorted(glob.glob(self.out_record_search), key=os.path.getmtime, reverse=True)
        if (len(files) == 0): return 0
        return int(os.path.splitext(files[0])[0].split('_')[-1]) + 1

class CameraCapture:
    def __init__(self, cam, seg_time, seg_wrap):
        # Required for rebooting the camera
        self.ip, self.onvif_port, self.username, self.password, self.reboot_on_failure = \
            cam.ip, cam.onvif_port, cam.username, cam.password, cam.reboot_on_failure
        self.rebooting = False

        self.live_streams = [] # Stores all live stream captures
        for idx, stream in enumerate(cam.streams):
            if idx == 0: # Record only the first stream
                self.record_stream = RecordStreamCapture(cam, stream, seg_time, seg_wrap)
            self.live_streams.append(LiveStreamCapture(cam, stream))

    def health_check(self):
        if not self.reboot_on_failure:
            self.health_check_standard()
        else:
            self.health_check_reboot_on_failure()

    def health_check_standard(self):
        if not self.record_stream.is_alive():
            logger.info('#### Recording from %s is dead. Restarting...' % self.record_stream.name)
            self.record_stream.restart()
        for capture in self.live_streams:
            if not capture.is_alive():
                logger.info('#### Live streaming from %s [stream:%s] is dead. Restarting...' % (capture.name, capture.stream.name))
                capture.restart()

    def health_check_reboot_on_failure(self):
        if self.rebooting:
            self.restart_all_streams_after_reboot() # Assume the reboot is complete
        else:
            attempt_reboot = False
            if not self.record_stream.is_alive():
                logger.info('#### Recording from %s is dead.' % self.record_stream.name)
                attempt_reboot = True
            for capture in self.live_streams:
                if not capture.is_alive():
                    logger.info('#### Live streaming from %s [stream:%s] is dead.' % (capture.name, capture.stream.name))
                    attempt_reboot = True
            if attempt_reboot:
                self.reboot()

    def restart_all_streams_after_reboot(self):
        logger.info('#### Restarting recording from %s...' % self.record_stream.name)
        self.record_stream.restart()
        for capture in self.live_streams:
            logger.info('#### Restarting live streaming from %s [stream:%s]...' % (capture.name, capture.stream.name))
            capture.restart()
        self.rebooting = False

    def reboot(self):
        if not self.onvif_port or not self.reboot_on_failure:
            return

        try:
            cam = ONVIFCamera(self.ip, self.onvif_port, self.username, self.password, onvif_wsdl_defs)
            logger.info('######## Rebooting %s : %s' % (self.ip, cam.devicemgmt.SystemReboot()))
            self.rebooting = True
        except Exception:
            logger.exception('Failed to reboot %s' % self.ip)

class CheckDiskUsage:
    def __init__(self, config):
        self.config = config
        self.capture_path = os.path.join(config.root_path, config.capture_dir)

        while self.__is_usage_exceeded():
            oldest_file = self.__get_oldest_cam_file()
            if oldest_file:
                logger.info('#### Deleting oldest recording: %s' % os.path.basename(oldest_file))
                os.remove(oldest_file)
            else: # Sanity check
                break

    def __get_disk_usage(self):
        usage = shutil.disk_usage(self.capture_path)
        return usage.total, usage.free

    def __is_usage_exceeded(self):
        total, free = self.__get_disk_usage()
        return True if (int((free / total) * 100) < self.config.min_free_disk_percent) else False

    def __get_oldest_cam_file(self):
        oldest_mtime = None
        oldest_file = None

        for cam in self.config.cameras:
            cam_dir = os.path.join(self.capture_path, cam.name)

            files = [os.path.join(cam_dir, f) for f in os.listdir(cam_dir) if re.match('.*\.mp4$', f, re.IGNORECASE)]
            files.sort(key=lambda x: os.path.getmtime(x))

            if len(files) == 0: continue

            oldest_cam_file = files[0]
            oldest_cam_mtime = os.path.getmtime(oldest_cam_file)

            if not oldest_mtime or oldest_cam_mtime < oldest_mtime:
                oldest_mtime = oldest_cam_mtime
                oldest_file = oldest_cam_file

        return oldest_file

    def __get_cam_most_usage(self):
        max_percent_over = 0
        cam_most_usage = None

        for cam in self.cam_usage:
            current = self.cam_usage[cam]['total']
            expected = (self.cam_usage[cam]['average'] / self.total_average_rec_size) * self.max_usage
            if current < expected: continue
            percent_over = ((current - expected) / expected) * 100
            if percent_over < max_percent_over: continue
            max_percent_over = percent_over
            cam_most_usage = cam
        return cam_most_usage

    def __delete_oldest_rec(self, cam_name):
        files = sorted(glob.glob(os.path.join(self.capture_path, cam_name, '*.mp4')), key=os.path.getmtime)
        logger.info('#### Deleting oldest recording: %s' % os.path.basename(files[0]))
        os.remove(files[0])

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
            elif isinstance(value, list): # Support objects in a list
                value = [AttrifyDict(item) for item in value]
            super().__setitem__(key, value)

        def __getitem__(self, key):
            return self.get(key)

        __setattr__, __getattr__ = __setitem__, __getitem__

    with open(config_file) as json_config:
        config = json.load(json_config)
    return AttrifyDict(config)

def health_check(cc_list):
    for cc in cc_list:
        cc.health_check()

def configure_logging(config):
    logger.setLevel(logging.DEBUG)

    log_dir = os.path.join(config.root_path, config.logs_dir)
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    log_path = os.path.join(log_dir, config.capture_log)

    handler = RotatingFileHandler(
        log_path,
        maxBytes=config.log_max_bytes,
        backupCount=config.log_backup_count
    )
    formatter = logging.Formatter('%(asctime)s %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)

def capture_from_cameras(config):
    global update_dead_time_secs
    global onvif_wsdl_defs

    cc_list = [] # Camera capture list

    update_dead_time_secs = config.time_must_be_dead_secs
    onvif_wsdl_defs = config.onvif_wsdl_defs

    logger.info('Starting capture...')

    capture_dir = os.path.join(config.root_path, config.capture_dir)
    if not os.path.exists(capture_dir):
        os.mkdir(capture_dir)
    os.chdir(capture_dir)

    for c in config.cameras:
        cc_list.append(CameraCapture(c, config.segment_length, config.segment_wrap))

    while True:
        time.sleep(config.health_poll_secs)
        health_check(cc_list)
        CheckDiskUsage(config)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('config_file', help='CCTV JSON configuration file.')
    args = parser.parse_args()

    config = load_config(args.config_file)
    configure_logging(config)

    try:
        capture_from_cameras(config)
    except Exception:
        logger.exception('Fatal error in main loop')

if __name__ == "__main__":
    main()
