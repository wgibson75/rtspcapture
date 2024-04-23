FROM alpine:3.19.0

RUN apk update \
    && apk add ffmpeg \
    && apk add git \
    && apk add py3-pip \
    && apk add python3 \
    && git clone https://github.com/FalkTannhaeuser/python-onvif-zeep.git \
    && cd python-onvif-zeep && python setup.py install

CMD /app/capture.py /config/config.json
