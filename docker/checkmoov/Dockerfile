FROM alpine:3.19.0 AS build

RUN apk update \
    && apk add build-base \
    && apk add ffmpeg \
    && apk add git \
    && apk add make \
    && apk add openssh \
    && apk add wget \
    && apk add yasm \
    && git clone https://github.com/anthwlock/untrunc.git \
    && cd untrunc \
    && make FF_VER=3.3.9

FROM alpine:3.19.0

ARG ssh_public_key

RUN apk update \
    && apk add runit \
    && apk add openrc --no-cache \
    && apk add openssh \
    && apk add apache2 \
    && apk add apache2-ssl \
    && apk add ffmpeg \
    && apk add git \
    && apk add nodejs \
    && apk add py3-pip \
    && apk add python3 \
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
