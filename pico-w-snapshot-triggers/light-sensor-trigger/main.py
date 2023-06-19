#!/usr/bin/env python3
import time
import machine
from wlan_connection import Connection
from machine import ADC, Pin

WIRELESS_SSID = 'love NZ'   # Wireless LAN SSID
WIRELESS_PSWD = '' # Wireless LAN password

# Snapshot request details
SERVER_NAME   = 'pluto.local'
SERVER_PORT   = 8080
SNAPSHOT_ARGS = 'n=driveway&c=front_of_house'
SNAPSHOT_CMD  = '/snapshot?%s' % SNAPSHOT_ARGS

PHOTO_PIN                      = 26    # GPIO pin to detect light level
LIGHT_CHANGE_THRESHOLD         = 10    # Percentage difference in light level that constitutes a change
LIGHT_POLL_INTERVAL_MS         = 300   # Interval in milliseconds between light level polls
DEBOUNCE_TIME_MS               = 10000 # Defines the period in milliseconds that must elapse before next trigger
MAX_NUM_SNAPSHOTS_BEFORE_RESET = 100   # Reset the board after this number of snapshots

# Get the percentage light change between two light values
def get_light_change(level1, level2):
    if level1 < level2:
        return level2 - level1
    elif level1 > level2:
        return -abs(level1 - level2)
    else:
        return 0

def detect_light_change(conn):
    last_level = None
    debounce_time = None
    snapshot_count = 0

    while True:
        photo_res = ADC(Pin(PHOTO_PIN))
        light_reading = photo_res.read_u16()
        current_level = light_reading / 65535 * 100
        #print('Light level: %.1f' % current_level)

        if debounce_time:
            time_now = time.ticks_ms()
            if ((time_now - debounce_time) > DEBOUNCE_TIME_MS) or (time_now < debounce_time):
                debounce_time = None

        if last_level:
            change = get_light_change(last_level, current_level)
            #print('percentage change: %.1f' % change)

            if (abs(change) >= LIGHT_CHANGE_THRESHOLD
                and change > 0
                and debounce_time == None):
                debounce_time = time.ticks_ms()
                print('Lights on')
                success = conn.request(SNAPSHOT_CMD) # Request a snapshot
                if not success:
                    conn.reconnect()
                snapshot_count += 1
                
                if snapshot_count == MAX_NUM_SNAPSHOTS_BEFORE_RESET:
                    print('Resetting after %d snapshots' % snapshot_count)
                    machine.reset()

        last_level = current_level
        time.sleep_ms(LIGHT_POLL_INTERVAL_MS)

def main():
    # Use snapshot arguments as the client ID
    conn = Connection(WIRELESS_SSID, WIRELESS_PSWD, SERVER_NAME, SERVER_PORT, SNAPSHOT_ARGS)
    conn.connect()

    detect_light_change(conn)

if __name__ == "__main__":
    main()
