FROM alpine:3.19.0

RUN apk update \
    && apk add ffmpeg=6.1.1-r0 \
    && apk add git=2.43.0-r0 \
    && apk add py3-pip=23.3.1-r0 \
    && apk add python3=3.11.8-r0 \
    && git clone https://github.com/FalkTannhaeuser/python-onvif-zeep.git \
    && cd python-onvif-zeep && python setup.py install

CMD /app/capture.py /config/config.json