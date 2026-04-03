const fs     = require('graceful-fs');
const path   = require('path');
const config = require('./config');

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
            return new Date(bStat.birthtime).getTime() - new Date(aStat.birthtime).getTime();
        });
        return sortedFiles;
    },

    getFilesSortedByDate: function(dirPath, ext) {
        return fs.readdirSync(dirPath)
            .map(filename => ({
                name: filename,
                stat: fs.statSync(path.join(dirPath, filename))
            }))
            .filter(({ name, stat }) => {
                const matchesExt = !ext || path.extname(name) === `.${ext}`;
                return stat.isFile() && matchesExt;
            })
            .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
            .map(item => [item.name, item.stat]);
    },

    getFilenamesSortedByDate: function(dirPath, ext) {
        return this.getFilesSortedByDate(dirPath, ext).map((entry) => entry[0]);
    },

    getTimestampNow: function() {
        let date = new Date()
        return date.getTime();
    },

    getTotalRecordTimeDays: function() {
        const cameras = config.get('cameras');
        const regex = /.*_\d+\..*/; // Match only numbered recording files

        // Get the oldest recording timestamp across all cameras
        const oldestTimestamp = cameras.reduce((earliest, camera) => {
            const cameraPath = this.getCameraCaptureDir(camera.name);

            if (!fs.existsSync(cameraPath)) return earliest;

            // Find the oldest file in the camera directory
            const oldestInCamera = fs.readdirSync(cameraPath)
                .filter(name => regex.test(name))
                .sort() // Alphabetical sort works for numbered recordings
                [0];    // Get the first (oldest) recording

            if (!oldestInCamera) return earliest;

            const { ctimeMs } = fs.statSync(path.join(cameraPath, oldestInCamera));

            // Return whichever time is older
            return (earliest === 0 || ctimeMs < earliest) ? ctimeMs : earliest;
        }, 0);

        if (oldestTimestamp === 0) return 0;

        const msPerDay = 1000 * 60 * 60 * 24;
        return ((Date.now() - oldestTimestamp) / msPerDay).toFixed(2);
    },

    isCameraNameValid: function(cameraName) {
        let isValid = false;
        config.get('cameras').forEach((camera) => {
            if (camera.name == cameraName) isValid = true;
        });
        return isValid;
    },

    getCameraCaptureDir: function(cameraName) {
        return path.join(config.get('root_path'), config.get('capture_dir'), cameraName);
    },

    getQuotedCameraNames: function() {
        let cameras = [];
        config.get('cameras').forEach((camera) => {
            cameras.push(`'${camera.name}'`); // Camera name (quoted string for EJS)
        });
        return cameras;
    },

    getLatestRecordingFilename: function(cameraName) {
        const captureDir = this.getCameraCaptureDir(cameraName);

        if (!fs.existsSync(captureDir)) return null;

        return fs.readdirSync(captureDir)
            .filter(file => path.extname(file) === '.mp4')
            .map(file => {
                try {
                    return { file, mtime: fs.statSync(path.join(captureDir, file)).mtimeMs };
                } catch (e) {
                    return { file, mtime: 0 }; // Handle files deleted during the read
                }
            })
            .sort((a, b) => b.mtime - a.mtime)[0]?.file || null;
    }
};
