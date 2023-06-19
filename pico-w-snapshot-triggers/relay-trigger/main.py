#!/usr/bin/env python3
import time
import machine
from wlan_connection import Connection
from machine import Pin

WIRELESS_SSID = 'love NZ'   # Wireless LAN SSID
WIRELESS_PSWD = '' # Wireless LAN password

# Snapshot request details
SERVER_NAME   = 'pluto.local'
SERVER_PORT   = 8080
SNAPSHOT_ARGS = 'n=shed&c=shed&c=shed_door&c=side_of_shed&c=side_of_shed_2&c=back_of_house&c=side_of_potting_shed'
SNAPSHOT_CMD  = '/snapshot?%s' % SNAPSHOT_ARGS

GPIO_PIN                       = 14  # GPIO pin to detect lights state
STATE_NUM_POLLS                = 10  # Number of polls to detect state
STATE_READ_INTERVAL_MS         = 40  # Interval in milliseconds between state polls
MAX_NUM_SNAPSHOTS_BEFORE_RESET = 100 # Reset the board after this number of snapshots

def check_state_change(state_to_check):
    pin = Pin(GPIO_PIN, mode=Pin.IN, pull=Pin.PULL_DOWN)
    # To combat electrical interference, the pin state is only deemed
    # valid after repeated state readings taken over a short period
    for poll in range(STATE_NUM_POLLS):
        state = pin.value()
        if state != state_to_check:
            return False
        time.sleep_ms(STATE_READ_INTERVAL_MS)
    return True

def listen_for_state_change(conn):
    snapshot_count = 0
    state = False

    while True:
        # State is ON
        if state:
            if check_state_change(False): # State changed to OFF
                print('State is OFF')
                if snapshot_count == MAX_NUM_SNAPSHOTS_BEFORE_RESET:
                    print('Resetting after %d snapshots' % snapshot_count)
                    machine.reset()
                state = False
        # State is OFF
        else:
            if check_state_change(True): # State changed to ON
                print('State is ON')
                success = conn.request(SNAPSHOT_CMD) # Request a snapshot
                if not success:
                    conn.reconnect()
                snapshot_count += 1
                state = True

def main():
    # Use snapshot arguments as the client ID
    conn = Connection(WIRELESS_SSID, WIRELESS_PSWD, SERVER_NAME, SERVER_PORT, SNAPSHOT_ARGS)
    conn.connect()

    listen_for_state_change(conn)

if __name__ == "__main__":
    main()
