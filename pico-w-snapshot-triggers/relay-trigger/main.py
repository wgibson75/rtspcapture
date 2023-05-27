#!/usr/bin/env python3
import network
import socket
import time
import machine

from machine import Pin

WIRELESS_SSID = 'love NZ'
WIRELESS_PSWD = 'monkeypoo'
WIRELESS_TIMEOUT_SECS = 10

GPIO_PIN = 14
SERVER_NAME = 'pluto.local'
SERVER_PORT = 8080
SNAPSHOT_CMD = '/snapshot?n=shed&c=shed&c=shed_door&c=side_of_shed&c=side_of_shed_2&c=back_of_house'
MAX_SNAPSHOTS_BEFORE_RESET = 100 # Reset after this number of snapshots
STATE_NUM_POLLS = 10
STATE_READ_INTERVAL_MS = 40

def connect_to_wlan():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(WIRELESS_SSID, WIRELESS_PSWD)

    wait = WIRELESS_TIMEOUT_SECS
    while not wlan.isconnected() and wait > 0:
        print('Connecting to wireless network...')
        wait -= 1
        time.sleep(1)

    if wlan.isconnected():
        status = wlan.ifconfig()
        print('Connected. IP address is %s' % status[0])
    else:
        machine.reset() # Reset and hope for the best

def take_snapshot():
    reconnect = False
    s = socket.socket()
    try:
        ai = socket.getaddrinfo(SERVER_NAME, SERVER_PORT)
        addr = ai[0][-1]
        print('Connecting to address: ', addr)
        s.connect(addr)
        print('Taking snapshot: %s' % SNAPSHOT_CMD)
        s.send(b'GET %s HTTP/1.0\r\n\r\n' % SNAPSHOT_CMD)
        print(s.recv(1024))
    except Exception as e:
        print('Failed to take snapshot: %s' % e)
        reconnect = True
    s.close() # Always close the socket
    if reconnect:
        connect_to_wlan()

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

def listen_for_state_change():
    snapshot_count = 0
    state = False
    while True:
        # State is ON
        if state:
            if check_state_change(False): # State changed to OFF
                print('State is OFF')
                if snapshot_count == MAX_SNAPSHOTS_BEFORE_RESET:
                    print('Resetting after %d snapshots' % snapshot_count)
                    machine.reset()
                state = False
        # State is OFF
        else:
            if check_state_change(True): # State changed to ON
                print('State is ON')
                take_snapshot()
                snapshot_count += 1
                state = True

# Connect to the wireless network
connect_to_wlan()

# Listen for lights state change
listen_for_state_change()
