import subprocess
import logging


class CommandProc:
    def __init__(self, cmd):
        self.cmd = cmd
        logging.info(f'Invoking command: {self.get_cmd()}')
        self.process = subprocess.Popen(self.cmd)

    def is_alive(self):
        if self.process.poll() is None:
            return True
        return False

    def kill(self):
        self.process.terminate()

    def get_cmd(self):
        return ' '.join(self.cmd)

