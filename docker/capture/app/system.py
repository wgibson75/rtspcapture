import os
import sys
import time

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
            
        real_path = os.path.realpath(sys_dev_link)
        
        if "mmcblk" in real_path:
            logging.critical('=' * 60)
            logging.critical(f'CRITICAL ERROR: {storage_path} is currently residing on the MicroSD card!')
            logging.critical('This indicates the host failed to mount the SSD after reboot.')
            logging.critical('Aborting execution immediately to prevent MicroSD degradation.')
            logging.critical('=' * 60)
            
        logging.info(f"Storage verification passed. {storage_path} is safely routed to external storage.")
        is_valid = True
        
    except Exception:
        logging.exception('CRITICAL ERROR: Failed to run storage safeguard check')

    return is_valid


def reboot_host():
    trigger_path = "/host_proc/sysrq-trigger"
    
    if not os.path.exists(trigger_path):
        logging.error(f"Reboot trigger path not found: {trigger_path}")
        sys.exit(1)

    logging.info("Initiating emergency host reboot sequence via SysRq...")
    
    try:
        with open(trigger_path, "w") as sysrq:
            # 1. Sync filesystems immediately while Python is still alive
            logging.info("Sending 's' (syncing disks)")
            sysrq.write("s\n")
            sysrq.flush()
            time.sleep(2) 
            
            # 2. Remount filesystems read-only
            logging.info("Sending 'u' (remounting read-only)")
            sysrq.write("u\n")
            sysrq.flush()
            time.sleep(1)
            
            # 3. Hard reboot (We bypass 'e' and 'i' so Python isn't killed prematurely)
            logging.info("Sending 'b' (rebooting host now!)")
            sysrq.write("b\n")
            sysrq.flush()
            
    except PermissionError:
        logging.error("Permission denied. Ensure the container has privileged access or appropriate capabilities.")
        sys.exit(1)
