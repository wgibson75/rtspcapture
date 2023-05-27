#!/usr/bin/env python3
import network
import socket
import time
import machine

from machine import ADC, Pin

WIRELESS_SSID = 'love NZ'
WIRELESS_PSWD = 'monkeypoo'
WIRELESS_TIMEOUT_SECS = 10

PHOTO_PIN = 26
SERVER_NAME = 'pluto.local'
SERVER_PORT = 8080
SNAPSHOT_CMD = '/snapshot?n=driveway&c=front_of_house'
MAX_SNAPSHOTS_BEFORE_RESET = 100 # Reset after this number of snapshots
LIGHT_CHANGE_THRESHOLD = 10      # Percentage difference in light level that constitutes a change
LIGHT_POLL_INTERVAL_MS = 300
DEBOUNCE_TIME_MS = 10000

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

# Get the percentage light change between two light values
def get_light_change(level1, level2):
    if level1 < level2:
        return level2 - level1
    elif level1 > level2:
        return -abs(level1 - level2)
    else:
        return 0

def detect_light_change():
    last_level = None
    debounce_time = None
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
                take_snapshot()

        last_level = current_level
        time.sleep_ms(LIGHT_POLL_INTERVAL_MS)

# Connect to the wireless network
connect_to_wlan()

# Listen for lights state change
detect_light_change()
