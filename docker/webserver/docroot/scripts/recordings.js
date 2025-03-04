// Used by the play template

class Recordings {
    #captureDir      = null; // Capture directory
    #camera          = null; // Camera name
    #cameraList      = null;
    #loadedCbs       = [];   // List of callbacks to notify when recordings loaded
    #recordings      = [];   // Recordings in reverse chronological order (including non playable live first)
    #dayBoundaryIdxs = [];   // List of day boundary indexes i.e. indexes of first recording in each day

    constructor(camera, cameraList, captureDir) {
        // Trigger loading recordings for this camera
        this.setCamera(camera);

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
}
