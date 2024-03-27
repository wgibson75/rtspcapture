#!/bin/sh

cd /app
npm install
node /app/server.js /config/config.json
