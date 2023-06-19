import network
import socket
import time
import machine

class Connection:

    # Maximum number of connection attempts
    MAX_NUM_CONNECTION_ATTEMPTS = 10

    # URL request to signal successful connection
    # Arg1 = IP address of client
    # Arg2 = Client ID
    CONNECTED_REQUEST_URL = '/connected_snapshot_trigger?ip=%s&%s'

    def __init__(self, ssid, password, server, port, client_id):
        self.ssid      = ssid
        self.password  = password
        self.server    = server
        self.port      = port
        self.client_id = client_id

        self.wlan = network.WLAN(network.STA_IF)
        self.wlan.active(True)

    def connect(self):
        self.wlan.connect(self.ssid, self.password)

        attempts_left = self.MAX_NUM_CONNECTION_ATTEMPTS        
        while not self.wlan.isconnected() and attempts_left > 0:
            print('Connecting to wireless network...')
            attempts_left -= 1
            time.sleep(1) # Sleep for 1 second between connection attempts

        if self.wlan.isconnected():
            status = self.wlan.ifconfig()
            print('Connected. IP address is %s' % status[0])
            self.request(self.CONNECTED_REQUEST_URL % (status[0], self.client_id))
        else:
            machine.reset() # Reset and hope for the best

    def disconnect(self):
        self.wlan.disconnect()

        while self.wlan.isconnected():
            print('Waiting for disconnection')
            time.sleep_ms(10)

    def reconnect(self):
        self.disconnect()
        self.connect()

    def request(self, url):
        success = False
        
        s = socket.socket()
        try:
            ai = socket.getaddrinfo(self.server, self.port)
            addr = ai[0][-1]
            print('Connecting to address: ', addr)
            s.connect(addr)
            print('HTTP Get: %s:%s%s' % (self.server, self.port, url))
            s.send(b'GET %s HTTP/1.0\r\n\r\n' % url)
            print(s.recv(1024))
            success = True
        except Exception as e:
            print('Request failed: %s' % e)
        s.close()

        return success
