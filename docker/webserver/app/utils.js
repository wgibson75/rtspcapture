const fs       = require('graceful-fs');
const path     = require('path');
const util     = require('util');
const execSync = require('child_process').execSync;
const config   = require('./config');
const logger   = require('./logger');

const DURATION_CMD = 'ffprobe -i %s -show_entries format=duration -v quiet -of csv="p=0"'

module.exports = {
    sortFilesByName: function(fitems) {
        let sortedFiles = fitems.sort((a, b) => {
            let aName = a[0], bName = b[0];
            return aName.localeCompare(bName, 'en', { numeric: true });
        });
        return sortedFiles;
    },

    sortFilesByDate: function(fitems) {
        let sortedFiles = fitems.sort((a, b) => {
            let aStat = a[1], bStat = b[1];
            return new Date(bStat.mtime).getTime() - new Date(aStat.mtime).getTime();
        });
        return sortedFiles;
    },

    getFilenamesSortedByDate: function(dirPath, ext) {
        let files = [];
        let regEx = undefined;

        if (ext !== undefined) {
            regEx = new RegExp('^.*\.' + ext + '$'); 
        }

        fs.readdirSync(dirPath).forEach((filename) => {
            let fstat = fs.statSync(dirPath + '/' + filename);
            let fitem = [filename, fstat];

            if (fstat.isDirectory() ||                               // Ignore directories
                ((regEx !== undefined) && (!regEx.test(filename)))) { // Ignore files that don't match extension
                return;
            }

            files.push(fitem);
        });
        return this.sortFilesByDate(files).map((entry) => entry[0]);
    },

    getTimestampNow: function() {
        let date = new Date()
        return date.getTime();
    },

    getVideoDurationSecs: function(filepath) {
        let duration = 0;
        let cmd = util.format(DURATION_CMD, filepath);

        try {
            duration = parseFloat(execSync(cmd));
        }
        catch (err) {
            console.log(util.format('Failed to get video duration [%s]', err.toString()));
        }
        return duration;
    },

    getStartTimeOfCamRecsEpochMs: function(cameraName) {
        let cameraPath = path.join(config.get('root_path'), config.get('capture_dir'), cameraName);

        if (!fs.existsSync(cameraPath)) return; // Camera directory doesn't exist

        let files = [];
        let regex = /.*_\d+\..*/; // Match only numbered recording files
        fs.readdirSync(cameraPath).forEach((filename) => {
            if (!filename.match(regex)) {
                return;
            }
            files.push(filename);
        });

        if (files.length == 0) return; // No camera recordings

        let oldestFile = files.sort().shift();
        let filepath = path.join(cameraPath, oldestFile);
        let fstat = fs.statSync(filepath);
        let duration = this.getVideoDurationSecs(filepath);

        return fstat.mtimeMs - (duration * 1000);
    },

    getTotalRecordTimeDays: function() {
        let time = 0

        config.get('cameras').forEach((camera) => {
            startTime = this.getStartTimeOfCamRecsEpochMs(camera.name);
            if ((time == 0) || (startTime < time))
            {
                time = startTime;
            }
        });

        if (time == 0) return 0;

        let now = new Date().getTime();
        return ((now - time) / (1000 * 24 * 60 * 60)).toFixed(2);
    },

    isCameraNameValid: function(cameraName) {
        let isValid = false;
        config.get('cameras').forEach((camera) => {
            if (camera.name == cameraName) isValid = true;
        });
        return isValid;
    }
};