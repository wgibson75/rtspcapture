import os
import sys

import logging


# Check the supplied storage path is not running on the internal MicroSD card
def check_storage_safeguard(storage_path):
    try:
        stat_info = os.stat(storage_path)
        sys_dev_link = f'/sys/dev/block/{os.major(stat_info.st_dev)}:{os.minor(stat_info.st_dev)}'
        
        if not os.path.exists(sys_dev_link):
            logging.critical(f'CRITICAL ERROR: Cannot access host hardware info via {sys_dev_link}.')
            logging.critical('Make sure your docker run command includes: -v /sys:/sys:ro')
            sys.exit(1)
            
        real_path = os.path.realpath(sys_dev_link)
        
        if "mmcblk" in real_path:
            logging.critical('=' * 60)
            logging.critical(f'CRITICAL ERROR: {storage_path} is currently residing on the MicroSD card!')
            logging.critical('This indicates the host failed to mount the SSD after reboot.')
            logging.critical('Aborting execution immediately to prevent MicroSD degradation.')
            logging.critical('=' * 60)
            sys.exit(1)
            
        logging.info(f"Storage verification passed. {storage_path} is safely routed to external storage.")
        
    except Exception as e:
        logging.exception(f'CRITICAL ERROR: Failed to run storage safeguard check: {e}')
        sys.exit(1)

