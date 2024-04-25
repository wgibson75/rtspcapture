FROM alpine:3.19.0

WORKDIR /auth
COPY ./auth/ssl-server.crt ./
COPY ./auth/ssl-server.key ./
COPY ./auth/cookie-secret.txt ./

RUN apk update \
    && apk add ffmpeg \
    && apk add nodejs \
    && apk add npm

CMD /app/startup.sh
#CMD sleep infinity
