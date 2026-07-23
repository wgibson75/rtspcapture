import os
import sys
import time
import subprocess

import logging


def check_storage_safeguard(storage_path):
    is_valid = False

    try:
        stat_info = os.stat(storage_path)
        # Warning: inside certain Docker configurations, st_dev may reflect the overlayfs ID
        sys_dev_link = f'/sys/dev/block/{os.major(stat_info.st_dev)}:{os.minor(stat_info.st_dev)}'
        
        if not os.path.exists(sys_dev_link):
            logging.critical(f'CRITICAL ERROR: Cannot access host hardware info via {sys_dev_link}.')
            logging.critical('Make sure your docker run command includes: -v /sys:/sys:ro')
        else:
            real_path = os.path.realpath(sys_dev_link)
            
            if "mmcblk" in real_path:
                logging.critical('=' * 60)
                logging.critical(f'CRITICAL ERROR: {storage_path} is currently residing on the MicroSD card!')
                logging.critical('This indicates the host failed to mount the SSD after reboot.')
                logging.critical('Aborting execution immediately to prevent MicroSD degradation.')
                logging.critical('=' * 60)
            else:
                logging.info(f"Storage verification passed. {storage_path} is safely routed to external storage.")
                is_valid = True
        
    except Exception:
        logging.exception('CRITICAL ERROR: Failed to run storage safeguard check')

    return is_valid


def reboot_host():
    # Setup immediate flushing for logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger()
    for handler in logger.handlers:
        handler.flush = sys.stderr.flush

    logging.info("Attempting to reboot host")
    sys.stderr.flush()

    # Try the standard and reliable container-to-host reboot
    try:
        logging.info("Attempting namespace-escaped host reboot")
        sys.stderr.flush()

        # Tell the host's systemd/system-init to reboot cleanly
        subprocess.run(["nsenter", "--target", "1", "--mount", "--uts", "--ipc", "--net", "--pid", "reboot"], check=True)

        # Wait for termination
        time.sleep(10)
    except Exception as e:
        logging.error(f"Namespace reboot failed: {e} - falling back to SysRq trigger")
        sys.stderr.flush()

    # Otherwise, fallback to forced SysRq sequence
    trigger_path = "/host_proc/sysrq-trigger"
    if not os.path.exists(trigger_path):
        logging.error(f"Reboot trigger path not found: {trigger_path}")
        sys.stderr.flush()
        sys.exit(1)

    try:
        # Open as unbuffered binary file
        with open(trigger_path, "wb", buffering=0) as f:
            logging.info("Sending SysRq 's' (syncing disks)...")
            sys.stderr.flush()
            f.write(b"s\n")
            time.sleep(2) 
            
            logging.info("Sending SysRq 'u' (remounting read-only)...")
            sys.stderr.flush()
            f.write(b"u\n")
            time.sleep(1)
            
            # WARNING: This may cause a power shutdown rather than a reboot
            logging.info("Sending SysRq 'b' (Hard resetting CPU)...")
            sys.stderr.flush()
            f.write(b"b\n")

            while True:
                time.sleep(1)
    except PermissionError:
        logging.error("Permission denied. Container requires --privileged mode.")
        sys.stderr.flush()
        sys.exit(1)
