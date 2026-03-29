#!/usr/bin/env python3
import argparse
import socket
import logging
import os
import subprocess
import signal
from threading import Thread

import config
import logger

HOST = '0.0.0.0'
PORT = 6666

# Pgrep pattern template to find recording process of given camera
PGREP_PATTERN_TEMPLATE = '\\-segment_start_number.* {0}/'


def kill_recording_process(client_id, camera_name):
    try:
        cmd = ['pgrep', '-f', PGREP_PATTERN_TEMPLATE.format(camera_name)]
        output = subprocess.check_output(cmd)

        pids = output.decode().split()
        num_pids = len(pids)

        if num_pids == 0:
            logging.error(f'No matching PID found')
        elif num_pids > 1:
            logging.error(f'Multiple matching PIDs found: {", ".join(pids)}')
        else:
            pid = int(pids[0])
            os.kill(pid, signal.SIGTERM)
            try:
                os.kill(pid, 0)  # Signal 0 just checks if PID is still running
                logging.info(f'Terminated process {pid}')
            except ProcessLookupError:
                logging.error(f'Failed to terminate process {pid}')

    except Exception as e:
        logging.error(f'Unexpected error: {e}')


def handle_request(conn, addr, cameras):
    client_id = f'{addr[0]}:{addr[1]}'  # <host>:<port>

    while True:
        try:
            msg = conn.recv(1024)
            if not msg:
                break
            camera_name = msg.decode().strip()
            if camera_name not in cameras:
                logging.warning(f'[{client_id}] Unknown camera: {camera_name}')
                break
            logging.info(f'[{client_id}] Kill recording: {camera_name}')
            kill_recording_process(client_id, camera_name)
        except:
            break

    conn.close()


# Get dictionary for checking camera names
def get_camera_dict(cfg):
    dict = {}
    for c in cfg.cameras:
        dict[c.name] = True
    return dict


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('config_file', help='CCTV JSON configuration file.')
    args = parser.parse_args()

    cfg = config.load(args.config_file)

    log_file = os.path.join(cfg.root_path, cfg.logs_dir, cfg.kill_rec_log)
    logger.configure(log_file, cfg.log_max_bytes, cfg.log_backup_count)

    logging.info('Starting...')

    cameras = get_camera_dict(cfg)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, PORT))
        s.listen()

        logging.info(f"[LISTENING] Server running on {HOST}:{PORT}")

        while True:
            conn, addr = s.accept()

            thread = Thread(target=handle_request, args=(conn, addr, cameras))
            thread.start()


if __name__ == "__main__":
    main()
