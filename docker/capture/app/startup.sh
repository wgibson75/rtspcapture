#!/bin/sh

shutdown() {
    echo "Caught signal. Shutting down..."
    # Forward signal to capture process
    if [ -n "$CAPTURE_PID" ]; then
        kill -TERM "$CAPTURE_PID" 2>/dev/null
        wait "$PID"
    fi
    exit 0
}

# Handle SIGTERM and SIGINT signals
trap shutdown TERM INT

# Start capture in background
echo "Starting capture..."
python /app/capture.py /config/config.json &
CAPTURE_PID=$!

# Wait for capture to exit
wait "$CAPTURE_PID"
EXIT_CODE=$?

echo "Capture exited with code $EXIT_CODE"
exit $EXIT_CODE

