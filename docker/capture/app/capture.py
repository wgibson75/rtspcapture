#!/usr/bin/env python3
import argparse
import os
import sys
import signal
import re
import glob
import shutil
import json
import logging
import asyncio
from onvif import ONVIFCamera

import config
import logger
import process
import stream

ONVIF_DEFS = None

# Camera capture list
CC_LIST = []

# Flags if we are shutting down
IS_SHUTTING_DOWN = False

# Lock required to manage any capture process
PROCESS_LOCK = asyncio.Lock()


class CameraCapture:
    def __init__(self, cam, seg_time, seg_wrap, no_update_is_dead_secs):
        self.name              = cam.name
        self.ip                = cam.ip
        self.onvif_port        = cam.onvif_port
        self.username          = cam.username
        self.password          = cam.password
        self.reboot_on_failure = cam.reboot_on_failure
        # Required for rebooting the camera
        self.rebooting         = False

        self.live_streams = []  # Stores all live stream captures
        for idx, s in enumerate(cam.streams):
            if idx == 0:  # Record only the first stream
                self.record_stream = stream.RecordStreamCapture(cam, s, seg_time, seg_wrap, no_update_is_dead_secs)
            self.live_streams.append(stream.LiveStreamCapture(cam, s, no_update_is_dead_secs))

    def health_check(self):
        if not self.reboot_on_failure:
            self.health_check_standard()
        else:
            self.health_check_reboot_on_failure()

    def health_check_standard(self):
        if not self.record_stream.is_alive():
            logging.info(f'#### Recording from {self.record_stream.name} is dead. Restarting...')
            self.record_stream.restart()
        for capture in self.live_streams:
            if not capture.is_alive():
                logging.info(f'#### Live streaming from {capture.name} [stream:{capture.stream.name}] is dead. Restarting...')
                capture.restart()

    def health_check_reboot_on_failure(self):
        if self.rebooting:
            self.restart_all_streams_after_reboot()  # Assume the reboot is complete
        else:
            attempt_reboot = False
            if not self.record_stream.is_alive():
                logging.info(f'#### Recording from {self.record_stream.name} is dead.')
                attempt_reboot = True
            for capture in self.live_streams:
                if not capture.is_alive():
                    logging.info(f'#### Live streaming from {capture.name} [stream:{capture.stream.name}] is dead.')
                    attempt_reboot = True
            if attempt_reboot:
                self.reboot()

    def restart_all_streams_after_reboot(self):
        logging.info(f'#### Restarting recording from {self.record_stream.name}...')
        self.record_stream.restart()
        for capture in self.live_streams:
            logging.info(f'#### Restarting live streaming from {capture.name} [stream:{capture.stream.name}]...')
            capture.restart()
        self.rebooting = False

    def reboot(self):
        if not self.onvif_port or not self.reboot_on_failure:
            return

        try:
            cam = ONVIFCamera(self.ip, self.onvif_port, self.username, self.password, ONVIF_DEFS)
            logging.info(f'######## Rebooting {self.ip} : {cam.devicemgmt.SystemReboot()}')
            self.rebooting = True
        except Exception:
            logging.exception(f'Failed to reboot {self.ip}')

    def get_live_streams(self):
        return self.live_streams

    def get_record_stream(self):
        return self.record_stream


class CheckDiskUsage:
    def __init__(self, cfg):
        self.cfg = cfg
        self.capture_path = os.path.join(cfg.root_path, cfg.capture_dir)

        while self.__is_usage_exceeded():
            oldest_file = self.__get_oldest_cam_file()
            if oldest_file:
                logging.info(f'#### Deleting oldest recording: {os.path.basename(oldest_file)}')
                os.remove(oldest_file)
            else:  # Sanity check
                break

    def __get_disk_usage(self):
        usage = shutil.disk_usage(self.capture_path)
        return usage.total, usage.free

    def __is_usage_exceeded(self):
        total, free = self.__get_disk_usage()
        return True if (int((free / total) * 100) < self.cfg.min_free_disk_percent) else False

    def __get_oldest_cam_file(self):
        oldest_mtime = None
        oldest_file = None

        for cam in self.cfg.cameras:
            cam_dir = os.path.join(self.capture_path, cam.name)

            files = [os.path.join(cam_dir, f) for f in os.listdir(cam_dir) if re.match('.*\.mp4$', f, re.IGNORECASE)]
            files.sort(key=lambda x: os.path.getmtime(x))

            if len(files) == 0:
                continue

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
            if current < expected:
                continue
            percent_over = ((current - expected) / expected) * 100
            if percent_over < max_percent_over:
                continue
            max_percent_over = percent_over
            cam_most_usage = cam
        return cam_most_usage

    def __delete_oldest_rec(self, cam_name):
        files = sorted(glob.glob(os.path.join(self.capture_path, cam_name, '*.mp4')), key=os.path.getmtime)
        logging.info(f'#### Deleting oldest recording: {os.path.basename(files[0])}')
        os.remove(files[0])


async def health_check():
    async with PROCESS_LOCK:
        if IS_SHUTTING_DOWN:
            return
        for cc in CC_LIST:
            cc.health_check()


async def capture_from_cameras(cfg):
    global ONVIF_DEFS
    global CC_LIST

    ONVIF_DEFS = cfg.onvif_wsdl_defs

    logging.info('Starting capture...')

    capture_dir = os.path.join(cfg.root_path, cfg.capture_dir)
    if not os.path.exists(capture_dir):
        os.mkdir(capture_dir)
    os.chdir(capture_dir)

    for c in cfg.cameras:
        CC_LIST.append(CameraCapture(c, cfg.segment_length, cfg.segment_wrap, cfg.time_must_be_dead_secs))

    while True:
        await asyncio.sleep(cfg.health_poll_secs)
        await health_check()
        CheckDiskUsage(cfg)


async def sigterm_handler():
    global IS_SHUTTING_DOWN

    async with PROCESS_LOCK:
        logging.info('[SIGTERM] Shutting down')
        IS_SHUTTING_DOWN = True
        for camera in CC_LIST:
            logging.info(f'Killing streams for camera: {camera.name}')
            for idx, live_stream in enumerate(camera.get_live_streams()):
                label = 'high def' if idx == 0 else 'low def'
                logging.info(f'-> {label} live stream')
                live_stream.kill()
            rec_stream = camera.get_record_stream()
            if rec_stream:
                logging.info('-> record stream')
                rec_stream.kill()


async def sigchld_handler():
    async with PROCESS_LOCK:
        if IS_SHUTTING_DOWN:
            return  # Ignore if we are shutting down

        logging.info('[SIGCHLD] Checking for killed recordings')

        for camera in CC_LIST:
            rec_stream = camera.get_record_stream()
            if rec_stream and not rec_stream.is_alive():
                logging.info(f'Recording killed for {camera.name} (restarting)')
                rec_stream.restart()


async def main():
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, lambda: asyncio.create_task(sigterm_handler()))
    loop.add_signal_handler(signal.SIGCHLD, lambda: asyncio.create_task(sigchld_handler()))

    parser = argparse.ArgumentParser()
    parser.add_argument('config_file', help='CCTV JSON configuration file.')
    args = parser.parse_args()

    cfg = config.load(args.config_file)

    log_file = os.path.join(cfg.root_path, cfg.logs_dir, cfg.capture_log)
    logger.configure(log_file, cfg.log_max_bytes, cfg.log_backup_count)

    process.CommandProc(cfg.kill_rec_daemon_cmd)

    try:
        await capture_from_cameras(cfg)
    except Exception:
        logging.exception('Fatal error in main loop')


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
