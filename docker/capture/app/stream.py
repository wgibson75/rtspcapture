import logging
import os
import re
import math
import glob
import shutil
from abc import ABC, abstractmethod
from datetime import datetime, timezone

import process


class StreamCapture(ABC):
    def __init__(self, cam, stream):
        self.name, self.username, self.password, self.ip, self.port, self.stream, self.capture_proc = \
            cam.name, cam.username, cam.password, cam.ip, cam.port, stream, None

        # Create top level camera capture directory
        if not os.path.isdir(self.name):
            os.mkdir(self.name, 0o777)

    @abstractmethod
    def is_alive(self):
        if self.capture_proc is None or not self.capture_proc.is_alive():
            return False
        return True

    @abstractmethod
    def _start(self):
        raise NotImplementedError()

    def kill(self):
        if self.capture_proc is not None:
            self.capture_proc.kill()
            self.capture_proc = None

    def restart(self):
        self.kill()
        self._start()

    def get_cmd(self):
        return self.capture_proc.get_cmd()


class LiveStreamCapture(StreamCapture):
    def __init__(self, cam, stream, no_update_is_dead_secs):
        super().__init__(cam, stream)

        # Create output directory for live streaming
        out_dir = f'{self.name}/{stream.name}'
        if os.path.isdir(out_dir):
            logging.info(f'Removing directory: {out_dir}')
            shutil.rmtree(out_dir)
        if not os.path.isdir(out_dir):
            os.mkdir(out_dir, 0o777)

        self.out_playlist = f'{out_dir}/live.m3u8'
        self.no_update_is_dead_secs = no_update_is_dead_secs
        self._start()

    def _start(self):
        url = f'rtsp://{self.username}:{self.password}@{self.ip}:{self.port}{self.stream.path}'
        cmd = []
        cmd.append(('ffmpeg'))
        cmd.extend(('-fflags', 'nobuffer'))
        cmd.extend(('-rtsp_transport', 'tcp'))
        cmd.extend(('-i', url))

        if (self.stream.include_audio):
            if (self.stream.live_audio_advance_secs is not None):
                # Advance timestamps in the next (second) input stream
                cmd.extend(('-itsoffset', f'{self.stream.live_audio_advance_secs}'))
                # Specify a second (same) input stream
                cmd.extend(('-i', url))
                # Take the video from the first input stream
                cmd.extend(('-map', '0:0'))
                # Take the audio from the second input stream
                cmd.extend(('-map', '1:1'))
            else:
                cmd.extend(('-map', '0'))
            cmd.extend(('-c:a', 'copy'))  # Copy the audio
        else:
            cmd.extend(('-map', '0:0'))

        cmd.extend(('-c:v', 'copy'))  # Copy the video
        cmd.extend(('-f', 'hls'))
        cmd.extend(('-hls_time', '1'))
        cmd.extend(('-hls_list_size', '10'))
        cmd.extend(('-hls_flags', 'delete_segments'))
        cmd.extend(('-hls_segment_type', 'fmp4'))
        if self.stream.aspect is not None:
            cmd.extend(('-aspect', self.stream.aspect))
        if (self.stream.xargs is not None):  # Add any extra arguments (ensuring we split on whitespace)
            cmd.extend((self.stream.xargs.split()))
        cmd.append((self.out_playlist))

        self.capture_proc = process.CommandProc(cmd)

    def is_alive(self):
        if not super().is_alive():
            return False
        if not os.path.isfile(self.out_playlist):
            return False
        secs_since_last_update = int(datetime.now(timezone.utc).timestamp() - os.lstat(self.out_playlist).st_mtime)
        if (secs_since_last_update > self.no_update_is_dead_secs):
            return False
        return True


class RecordStreamCapture(StreamCapture):
    def __init__(self, cam, stream, seg_time, seg_wrap, no_update_is_dead_secs):
        super().__init__(cam, stream)

        self.seg_time = seg_time
        self.seg_wrap = seg_wrap
        self.no_update_is_dead_secs = no_update_is_dead_secs

        # Setup output format and search pattern for recording segments
        self.out_record_format = f'{self.name}/{self.name}_%0{str(int(math.log10(self.seg_wrap)) + 1)}d.mp4'
        self.out_record_search = re.sub('%0\d+d', '*', self.out_record_format)

        self._start()

    def _start(self):
        url = f'rtsp://{self.username}:{self.password}@{self.ip}:{self.port}{self.stream.path}'
        cmd = []
        cmd.append(('ffmpeg'))
        cmd.extend(('-rtsp_transport', 'tcp'))  # Prevent use of UDP to avoid packet loss
        cmd.extend(('-i', url))
        cmd.extend(('-c', 'copy'))  # Take an exact copy of the input stream
        cmd.extend(('-map', '0:0' if not self.stream.include_audio else '0'))
        cmd.extend(('-f', 'segment'))
        cmd.extend(('-segment_time', f'{self.seg_time}'))
        cmd.extend(('-segment_wrap', f'{self.seg_wrap}'))
        cmd.extend(('-segment_start_number', f'{self.get_segment_start_num()}'))
        cmd.extend(('-reset_timestamps', '1'))
        if self.stream.vtag is not None:
            cmd.extend(('-tag:v', self.stream.vtag))
        if self.stream.aspect is not None:
            cmd.extend(('-aspect', self.stream.aspect))
        cmd.append((self.out_record_format))

        self.capture_proc = process.CommandProc(cmd)

    def is_alive(self):
        if not super().is_alive():
            return False
        files = sorted(glob.glob(self.out_record_search), key=os.path.getmtime, reverse=True)
        if (len(files) == 0):
            return False
        secs_since_last_update = int(datetime.now(timezone.utc).timestamp() - os.lstat(files[0]).st_mtime)
        if (secs_since_last_update > self.no_update_is_dead_secs):
            return False
        return True

    def get_segment_start_num(self):
        files = sorted(glob.glob(self.out_record_search), key=os.path.getmtime, reverse=True)
        if (len(files) == 0):
            return 0
        match = re.search(r'^.*?(\d+)\..*+$', files[0])
        if match:
            return int(match.group(1)) + 1  # Segment number
        else:
            raise Exception(f'Unable to determine segment start number ({files[0]})')

