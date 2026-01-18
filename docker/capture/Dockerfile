docker/capture/DockerfileFROM alpine:3.19.0

COPY requirements.txt .

RUN apk update \
    && apk add ffmpeg \
    && apk add git \
    && apk add py3-pip \
    && apk add python3 \
    && python3 -m venv /opt/venv \
    && . /opt/venv/bin/activate && pip3 install -r requirements.txt \
    && git clone https://github.com/FalkTannhaeuser/python-onvif-zeep.git \
    && cd python-onvif-zeep && python setup.py install

CMD . /opt/venv/bin/activate && /app/capture.py /config/config.json
