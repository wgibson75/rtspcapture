// Used by the play EJS template

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

                $(`#${--currentPlayIdx}`).click();           // Play the next video
                this.#control.scrollToEntry(currentPlayIdx); // Scroll to next video entry
            }
        });

        this.#video.addEventListener("play", e => {
            this.#isPaused = false;

            if (this.#control != null) {
                this.#control.showPlaybackState();
            }
        });

        this.#video.addEventListener("pause", e => {
            this.#isPaused = true;

            if (this.#control != null) {
                this.#control.showPlaybackState();
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


class Recordings {
    #captureDir       = null; // Capture directory
    #camera           = null; // Camera name
    #cameraList       = null;
    #loadedCbs        = [];   // List of callbacks to notify when recordings loaded
    #recordings       = [];   // Recordings in reverse chronological order (including non playable live first)
    #dayBoundaryIdxs  = [];   // List of day boundary indexes i.e. indexes of first recording in each day
    #noUpperCaseWords = {};   // Lookup of words in camera name to not upper case first letter

    constructor(camera, cameraList, captureDir) {
        this.setCamera(camera);              // Trigger loading recordings for this camera
        this.#buildNoUpperCaseWordsLookup(); // Build list of words to not upper case in camera name

        this.#cameraList = cameraList;
        this.#captureDir = captureDir;
    }

    #loadRecordings() {
      fetch(`/recordings?c=${this.#camera}`)
          .then((response) => {
              if (response.ok) return response.json();
          })
          .then((json) => {
              if (!json) return;

              this.#recordings      = []; // Empty all existing recordings entries
              this.#dayBoundaryIdxs = []; // Empty all day boundary entries

              for (let i = 0, currentDay = null; i < json.recordings.length; i++) {
                  let [file, crtime] = json.recordings[i];

                  let dateObj = new Date(crtime * 1000);
                  let year  = dateObj.getFullYear();
                  let month = dateObj.getMonth();
                  let date  = dateObj.getDate();
                  let day   = dateObj.getDay();
                  let hrs   = dateObj.getHours();
                  let mins  = dateObj.getMinutes();
                  let secs  = dateObj.getSeconds();

                  if (currentDay != day) {
                      if (currentDay != null) {
                          this.#dayBoundaryIdxs.push(i);
                      }
                      currentDay = day;
                  }
                  this.#recordings.push([file, crtime, year, month, date, day, hrs, mins, secs]);
              }
              // Call loaded callbacks
              for (const callback of this.#loadedCbs) callback();
          });
    }

    #buildNoUpperCaseWordsLookup() {
        let words = ["and", "in", "of", "or"];
        for (let w of words) {
            this.#noUpperCaseWords[w] = true;
        }
    }

    setLoadedCb(callback) {
        this.#loadedCbs.push(callback);
    }

    setCamera(camera) {
        this.#camera = camera;
        this.#loadRecordings();
    }

    prevCamera() {
        let idx = this.#cameraList.indexOf(this.#camera);
        if ((idx == -1) || (idx == 0)) return false;

        this.setCamera(this.#cameraList[--idx]);
        return true;
    }

    nextCamera() {
        let idx = this.#cameraList.indexOf(this.#camera);
        if ((idx == -1) || (idx == (this.#cameraList.length - 1))) return false;

        this.setCamera(this.#cameraList[++idx]);
        return true;
    }

    getNumRecordings() {
        return this.#recordings.length;
    }

    getDayBoundaryIndexes() {
        return this.#dayBoundaryIdxs;
    }

    getDateFields(idx) {
        if ((idx < 0) || (idx >= this.#recordings.length)) return;

        return this.#recordings[idx].slice(2); // Return only date related fields
    }

    getPlayUrl(idx) {
        if ((idx < 0) || (idx >= this.#recordings.length)) return;

        // Return the live stream URL for first recording or playback URL otherwise
        return (idx == 0)
            ? `/${CAPTURE_DIR}/${this.#camera}/high_res/live.m3u8`
            : `/${CAPTURE_DIR}/${this.#camera}/${this.#recordings[idx][0]}`;
    }

    getIdxAndOffsetForTime(t) {
        for (let i = 0; i < this.#recordings.length; i++) {
            let [file, crtime, year, month, date, day, hrs, mins, secs] = this.#recordings[i];

            if (t >= crtime) {
                let offset = t - crtime; // Position must be in seconds
                return [i, offset];
                break;
            }
        }
        return undefined;
      }

    getStartTimeEpochSecs(idx) {
        if ((idx < 0) || (idx >= this.#recordings.length)) return;

        let [file, crtime, year, month, date, day, hrs, mins, secs] = this.#recordings[idx];
        return crtime;
    }

    getCameraName() {
        let words = this.#camera.split(/[_-]/); // Split camera name on hyphens and/or underscore
        words.forEach((word, idx) => {
            // Upper case first letter of words accordingly
            if (!(word in this.#noUpperCaseWords)) {
                words[idx] = word.charAt(0).toUpperCase() + word.slice(1);
            }
        });
        // Join complete human readable name
        return words.join(" ");
    }
}


class Control {
    #LIVE_PLAY_ID                   = 0;    // ID of live playback stream
    #BUTTON_PRESS_HIGHLIGHT_TIME_MS = 500;  // Duration of button highlight when pressed
    #DAYS                           = ["Sun", "Mon", "Tue", "Wed", "Thur", "Fri", "Sat"];

    #recordings      = null;
    #playback        = null;
    #controlId       = null;
    #titleId         = null;
    #entriesId       = null;
    #playPauseId     = null;
    #playbackStateId = null;
    #iPhoneButtonsId = null;
    #repositionCb    = null;

    #currentPlayId      = null;
    #buttonPressTimeout = null;
    #pressedButton      = null;
    #nextPlaybackTime   = null; // Next playback time (as epoch) to use for next camera

    #isFlipped = false; // Only used for iPhone to flip positioning of control

    constructor(recsObj, playObj, elementIds, repositionCb) {
        this.#recordings      = recsObj;
        this.#playback        = playObj;
        this.#controlId       = elementIds["controlId"];
        this.#titleId         = elementIds["titleId"];
        this.#entriesId       = elementIds["entriesId"];
        this.#playPauseId     = elementIds["playPauseButtonId"];
        this.#playbackStateId = elementIds["playbackStateId"];
        this.#iPhoneButtonsId = elementIds["iphoneButtonsId"];
        this.#repositionCb    = repositionCb;

        this.#recordings.setLoadedCb(this.#recordingsLoadedCb.bind(this));
    }

    #recordingsLoadedCb() {
        this.#populate();
        this.#showCameraName();

        if (this.#nextPlaybackTime != null) {
            // Get the entry index and offset position that matches this playback time
            let [idx, offset] = this.#recordings.getIdxAndOffsetForTime(this.#nextPlaybackTime);

            this.scrollToEntry(idx);          // Scroll to the entry
            $(`#${idx}`).click();              // Click the entry to trigger playback
            this.#playback.setPosition(offset) // Set the playback position

            this.#nextPlaybackTime = null;
        }
        else {
            // Trigger live stream playback with normal speed
            $(`#${this.#LIVE_PLAY_ID}`).click();
            this.#playback.resetSpeed();
        }
    }

    #showCameraName() {
        $(`#${this.#titleId}`).text(this.#recordings.getCameraName());
    }

    #showButtonPress(button) {
        if (this.#buttonPressTimeout != null) {
            clearTimeout(this.#buttonPressTimeout);
            this.#hideButtonPress(this.#pressedButton);
        }
        $(`#${button.id}`).toggleClass("button-highlight");

        this.#pressedButton      = button;
        this.#buttonPressTimeout = setTimeout(this.#hideButtonPress.bind(this), this.#BUTTON_PRESS_HIGHLIGHT_TIME_MS, button);
    }

    #hideButtonPress(button) {
        $(`#${button.id}`).toggleClass("button-highlight");

        this.#buttonPressTimeout = null;
        this.#pressedButton      = null;
    }

    #populate() {
        // Clear the control first
        $(`#${this.#entriesId}`).empty();

        // Build lookup table for indexes of recordings on day boundary
        let dayRecIdxLookup = {};
        let dayRecIdxs = this.#recordings.getDayBoundaryIndexes();
        for (let i = 0; i < dayRecIdxs.length; i++) {
            dayRecIdxLookup[dayRecIdxs[i]]++;
        }

        // Now populate all entries in the control pane showing
        for (let idx = 0; idx < this.#recordings.getNumRecordings(); idx++) {
            let [year, month, date, day, hrs, mins, secs] = this.#recordings.getDateFields(idx);

            // Format certain time fields
            date  = ("0" + date).slice(-2);
            month = ("0" + (month + 1)).slice(-2);
            hrs   = ("0" + hrs).slice(-2);
            mins  = ("0" + mins).slice(-2);
            secs  = ("0" + secs).slice(-2);

            // Show day boundary
            if (idx in dayRecIdxLookup) {
                let text = `${this.#DAYS[day]} ${date}-${month}-${year}`;
                $(`#${this.#entriesId}`).append(`<div class="entry-day-boundary">${text}</div>`);
            }

            let text = (idx== this.#LIVE_PLAY_ID) ? "Live" : `${hrs}:${mins}:${secs}`; // First entry is live

            // Use the recording index as the entry ID
            $(`#${this.#entriesId}`).append(
                `<div class="entry-playback" id="${idx}" onclick="CONTROL.play(${idx})">` +
                `  <div><hr></div><div style="flex-grow: 1">${text}</div><div><hr></div>` +
                "</div>"
            );
        }

        // Only show button for flipping position on iPhone
        if (!IS_IPHONE) $(`#${this.#iPhoneButtonsId}`).hide();

        // Now show the control pane
        $(`#${this.#controlId}`).css("display", "flex");
    }

    #getCurrentPlaybackTime() {
        let startTime = this.#recordings.getStartTimeEpochSecs(this.#currentPlayId);
        let position  = Math.round(this.#playback.getPosition())

        return startTime + position;
    }

    // Note: recording index and corresponding entry ID in control pane are the same
    play(idx) {
        let url = this.#recordings.getPlayUrl(idx);
        this.#playback.play(url);

        // Set normal playback speed for live streaming
        if (idx == this.#LIVE_PLAY_ID) this.#playback.resetSpeed();

        // Handle selection highlight
        if ((this.#currentPlayId != null) && (this.#currentPlayId != idx)) {
            $(`#${this.#currentPlayId}`).removeClass("entry-playback-selected");
        }
        $("#" + idx).addClass("entry-playback-selected");
        this.#currentPlayId = idx;

        this.showPlaybackState();
    }

    getCurrentPlayIdx() {
        return this.#currentPlayId;
    }

    scrollToEntry(idx) {
        let panel = $(`#${this.#entriesId}`);
        let entry = $(`#${idx}`);

        panel.scrollTop(entry.offset().top - panel.offset().top + panel.scrollTop());
    }

    showPlaybackState() {
        $("#play-pause").html(this.#playback.isPaused() ? "Play" : "Pause");
        $("#play-state").html(this.#playback.getStatusString());
    }

    isFlipped() {
        return this.#isFlipped;
    }

    togglePlayPause(button) {
        if (this.#playback.togglePlayPause()) {
            this.#showButtonPress(button);
            this.showPlaybackState();
        }
    }

    speedUp(button) {
        if (this.#currentPlayId == this.#LIVE_PLAY_ID) return; // Do not support on live
        if (this.#playback.speedUp()) {
            this.#showButtonPress(button);
            this.showPlaybackState();
        }
    }

    speedDown(button) {
        if (this.#currentPlayId == this.#LIVE_PLAY_ID) return; // Do not support on live
        if (this.#playback.speedDown()) {
            this.#showButtonPress(button);
            this.showPlaybackState();
        }
    }

    prevCam(button) {
        if (!this.#recordings.prevCamera()) return;
        if (button) this.#showButtonPress(button);
        if (this.#currentPlayId == this.#LIVE_PLAY_ID) return; // Do not set playback time for live
        this.#nextPlaybackTime = this.#getCurrentPlaybackTime();
    }

    nextCam(button) {
        if (!this.#recordings.nextCamera()) return;
        if (button) this.#showButtonPress(button);
        if (this.#currentPlayId == this.#LIVE_PLAY_ID) return; // Do not set playback time for live
        this.#nextPlaybackTime = this.#getCurrentPlaybackTime();
    }

    seekBack(button) {
        if (this.#currentPlayId == this.#LIVE_PLAY_ID) return; // Do not support on live
        if (button) this.#showButtonPress(button);
        this.#playback.seekBack();
    }

    seekForward(button) {
        if (this.#currentPlayId == this.#LIVE_PLAY_ID) return; // Do not support on live
        if (button) this.#showButtonPress(button);
        this.#playback.seekForward();
    }

    reposition(button) {
        this.#showButtonPress(button);
        this.#isFlipped = !this.#isFlipped;
        this.#repositionCb(false, false, this.#isFlipped);
    }
}
