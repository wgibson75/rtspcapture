FROM alpine:3.19.0

WORKDIR /auth
COPY ./auth/ssl-server.crt ./
COPY ./auth/ssl-server.key ./
COPY ./auth/cookie-secret.txt ./

RUN apk update \
    && apk add ffmpeg=6.1.1-r0 \
    && apk add nodejs=20.12.1-r0 \
    && apk add npm=10.2.5-r0

CMD /app/startup.sh
