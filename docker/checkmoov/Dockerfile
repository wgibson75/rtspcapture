FROM alpine:3.19.0 AS build

RUN apk update \
    && apk add build-base=0.5-r3 \
    && apk add ffmpeg=6.1.1-r0 \
    && apk add git=2.43.0-r0 \
    && apk add make=4.4.1-r2 \
    && apk add openssh=9.6_p1-r0 \
    && apk add wget=1.21.4-r0 \
    && apk add yasm=1.3.0-r4 \
    && git clone https://github.com/anthwlock/untrunc.git \
    && cd untrunc \
    && make FF_VER=3.3.9

FROM alpine:3.19.0

ARG ssh_public_key

RUN apk update \
    && apk add runit=2.1.2-r7 \
    && apk add openrc=0.52.1-r2 --no-cache \
    && apk add openssh=9.6_p1-r0 \
    && apk add apache2=2.4.58-r1 \
    && apk add apache2-ssl=2.4.58-r1 \
    && apk add ffmpeg=6.1.1-r0 \
    && apk add git=2.43.0-r0 \
    && apk add nodejs=20.11.1-r0 \
    && apk add py3-pip=23.3.1-r0 \
    && apk add python3=3.11.8-r0 \
    && git clone https://github.com/FalkTannhaeuser/python-onvif-zeep.git \
    && cd python-onvif-zeep && python setup.py install \
    && mkdir -p /run/apache2 \
    && mkdir -p /root/.ssh \
    && chmod 0700 /root/.ssh \
    && echo "$ssh_public_key" > /root/.ssh/authorized_keys \
    # Generate the host keys
    && ssh-keygen -A \
    && echo -e "PasswordAuthentication no" >> /etc/ssh/sshd_config \
    && mkdir -p /run/openrc \
    && touch /run/openrc/softlevel

COPY --from=build /untrunc/untrunc /bin/untrunc

CMD /app/checkmoov.py /config/config.json