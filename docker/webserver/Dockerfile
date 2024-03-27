FROM alpine:3.19.0

WORKDIR /ssl
COPY ./ssl/server.crt ./
COPY ./ssl/server.key ./

RUN apk update \
    && apk add ffmpeg=6.1.1-r0 \
    && apk add nodejs=20.11.1-r0 \
    && apk add npm=10.2.5-r0

CMD /app/startup.sh