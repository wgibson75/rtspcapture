const fs = require('graceful-fs');

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
    }
};