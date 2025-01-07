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

    getTotalRecordTimeDays: function() {
        let time = 0
        let capture_root = path.join(config.get('root_path'), config.get('capture_dir'));

        config.get('cameras').forEach((camera) => {
            let camera_path = path.join(capture_root, camera.name);

            if (!fs.existsSync(camera_path)) return; // Camera directory doesn't exit

            let files = [];
            let regex = new RegExp('.*_\d+\..*'); // Match only numbered recording files
            fs.readdirSync(camera_path).forEach((filename) => {
                if (!filename.match(regex)) {
                    return;
                }
                files.push(filename);
            });

            if (files.length == 0) return; // No camera recordings

            let oldest_file = files.sort().shift();
            let fstat = fs.statSync(path.join(camera_path, oldest_file));

            // Creation time is good enough but note that if checkmoov has fixed
            // the recording then this will be later than the real creation time
            if ((time == 0) || (fstat.ctimeMs < time))
            {
                time = fstat.ctimeMs;
            }
        });

        if (time == 0) return 0;

        let now = new Date().getTime();
        return ((now - time) / (1000 * 24 * 60 * 60)).toFixed(2);
    }
};