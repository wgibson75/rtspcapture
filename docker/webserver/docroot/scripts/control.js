// Used by the play template

class Control {
    #LIVE_PLAY_ID                   = 0;    // ID of live playback stream
    #BUTTON_PRESS_HIGHLIGHT_TIME_MS = 500;  // Duration of button highlight when pressed
    #DAYS                           = ["Sun", "Mon", "Tue", "Wed", "Thur", "Fri", "Sat"];

    #recordings      = null;
    #playback        = null;
    #controlId       = null;
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

    constructor(recsObj, playObj, controlId, entriesId, playPauseId, playStateId, iPhoneButtonsId, repositionCb) {
        this.#recordings      = recsObj;
        this.#playback        = playObj;
        this.#controlId       = controlId;
        this.#entriesId       = entriesId;
        this.#playPauseId     = playPauseId;
        this.#playbackStateId = playStateId;
        this.#iPhoneButtonsId = iPhoneButtonsId;
        this.#repositionCb    = repositionCb;

        this.#recordings.setLoadedCb(this.#recordingsLoadedCb.bind(this));
    }

    #recordingsLoadedCb() {
        this.#populate();

        if (this.#nextPlaybackTime != null) {
            // Get the entry index and offset position that matches this playback time
            let [idx, offset] = this.#recordings.getIdxAndOffsetForTime(this.#nextPlaybackTime);

            this.#scrollToEntry(idx);          // Scroll to the entry
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

    #showPlaybackState() {
        $("#play-pause").html(this.#playback.isPaused() ? "Play" : "Pause");
        $("#play-state").html(this.#playback.getStatusString());
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

    #scrollToEntry(idx) {
        let panel = $(`#${this.#entriesId}`);
        let entry = $(`#${idx}`);

        panel.scrollTop(entry.offset().top - panel.offset().top + panel.scrollTop());
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

        this.#showPlaybackState();
    }

    getCurrentPlayIdx() {
        return this.#currentPlayId;
    }

    isFlipped() {
        return this.#isFlipped;
    }

    togglePlayPause(button) {
        if (this.#playback.togglePlayPause()) {
            this.#showButtonPress(button);
            this.#showPlaybackState();
        }
    }

    speedUp(button) {
        if (this.#currentPlayId == this.#LIVE_PLAY_ID) return; // Do not support on live
        if (this.#playback.speedUp()) {
            this.#showButtonPress(button);
            this.#showPlaybackState();
        }
    }

    speedDown(button) {
        if (this.#currentPlayId == this.#LIVE_PLAY_ID) return; // Do not support on live
        if (this.#playback.speedDown()) {
            this.#showButtonPress(button);
            this.#showPlaybackState();
        }
    }

    prevCam(button) {
        if (!this.#recordings.prevCamera()) return;
        if (button) this.#showButtonPress(button);
        this.#nextPlaybackTime = this.#getCurrentPlaybackTime();
    }

    nextCam(button) {
        if (!this.#recordings.nextCamera()) return;
        if (button) this.#showButtonPress(button);
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
