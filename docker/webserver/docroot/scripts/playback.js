// Used by the play template

class Playback {
    #SPEEDS           = [0, 0.5, 1, 2, 4, 8, 16]; // Supported playback speeds
    #NORMAL_SPEED_IDX = 2;                        // Index of normal playback speed
    #PAUSED_SPEED_IDX = 0;                        // Index of paused playback speed
    #SEEK_TIME_SECS   = 30;                       // Seek time in seconds

    #video      = null;
    #control    = null;
    #url        = null;
    #speedIdx   = this.#NORMAL_SPEED_IDX;
    #isPaused   = null;

    #sameSpeedForNextPlay = false;

    constructor(videoElementId) {
        this.#video = document.getElementById(videoElementId);

        this.#video.addEventListener("canplay", e => {
            $("#video").show();
        });

        this.#video.addEventListener("ended", e => {
            if (this.#control != null) {
                let currentPlayIdx = this.#control.getCurrentPlayIdx();
                $(`#${currentPlayIdx - 1}`).click(); // Play next video when current ends
            }
        });
    }

    setControl(controlObj) {
      this.#control = controlObj;
    }

    play(url) {
        if (!url) return false;

        this.#url = url;
        this.#isPaused = false;
        this.#video.src = url;
        this.#video.playbackRate = this.#SPEEDS[this.#speedIdx];

        return true;
    }

    togglePlayPause() {
        if (!this.#url) return false;

        if (this.#isPaused) {
            this.#video.play();
            this.#isPaused = false;
        }
        else {
            this.#video.pause()
            this.#isPaused = true;
        }
        return true;
    }

    isPaused() {
        return this.#isPaused;
    }

    speedUp() {
        if (!this.#url) return false;                        // Ignore if not playing anything
        if ((this.#speedIdx == (this.#SPEEDS.length - 1)) && // Ignore if already at max speed
            !this.#isPaused) return false;                   // and not paused

        if (this.#isPaused) {
            this.#speedIdx = this.#PAUSED_SPEED_IDX; // Set speed index to stopped
            this.togglePlayPause();                  // Toggle playback to commence
        }

        // Increment playback rate
        this.#video.playbackRate = this.#SPEEDS[++this.#speedIdx];

        return true;
    }

    speedDown() {
        if (!this.#url) return false;          // Ignore if not playing anything
        if (this.#speedIdx == 0) return false; // Ignore if already at min speed

        if (this.#isPaused) {
            this.togglePlayPause(); // Toggle playback to commence
        }

        // Decrement playback rate
        this.#video.playbackRate = this.#SPEEDS[--this.#speedIdx];

        return true;
    }

    resetSpeed() {
        // Reset speed to normal playback rate
        this.#speedIdx           = this.#NORMAL_SPEED_IDX;
        this.#video.playbackRate = this.#SPEEDS[this.#speedIdx];
    }

    seekForward() {
        this.#video.currentTime += this.#SEEK_TIME_SECS;
    }

    seekBack() {
        this.#video.currentTime -= this.#SEEK_TIME_SECS;
    }

    setPosition(position) {
        this.#video.currentTime = position;
    }

    getPosition() {
        return this.#video.currentTime;
    }

    getStatusString() {
        return (this.#isPaused) ? "Paused" : `x${this.#SPEEDS[this.#speedIdx]}`;
    }
}