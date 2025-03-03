const express     = require('express');
const ensureLogIn = require('connect-ensure-login').ensureLoggedIn;
const db          = require('../db');
const url         = require('url');
const path        = require('path');
const fs          = require('graceful-fs');
const mime        = require('mime-types');

const utils  = require('../utils');
const config = require('../config');
const logger = require('../logger');

const ensureLoggedIn = ensureLogIn();

///////////////////////////////////
////// Excluded File Lookups //////
///////////////////////////////////

const EXCLUDED_FILES         = [ 'init.mp4', '.moov_check' ]; // Filenames to exclude in directory listings
const EXCLUDED_EXTS          = [ '.m4s', '.css', '.json' ];   // Extentions of files to exclude in directory listings

const EXCLUDED_FILES_LOOKUP = {}, EXCLUDED_EXTS_LOOKUP = {};

EXCLUDED_FILES.forEach((x) => {
    EXCLUDED_FILES_LOOKUP[x] = true;
});

EXCLUDED_EXTS.forEach((x) => {
    EXCLUDED_EXTS_LOOKUP[x] = true;
});

////////////////////
////// Router //////
////////////////////

const router = express.Router();

router.get('/', function(request, response, next) {
    if (!request.user) {
        return response.render('login');
    }
    next();
});

router.get('^*\.css$', function(request, response, next) {
    handleContent_all(request, response);
});

router.get('/signup', ensureLoggedIn, function(request, response, next) {
    response.render('signup');
});

router.get('/accounts', ensureLoggedIn, function(request, response, next) {
    db.all('SELECT username FROM users ORDER BY username', [], (err, rows) => {
        var uids = [];
        rows.forEach((row) => {
            uids.push(row.username);
        });
        response.render('accounts', {usernames: uids, current_user: request.user.username});
    });
});

router.get('/console', ensureLoggedIn, function(request, response, next) {
    var cameras = [];
    config.get('cameras').forEach((camera) => {
        cameras.push(camera.name);
    });
    response.render('console', { capture_dir: config.get('capture_dir'), cameras: cameras });
});

router.get('/snapshots', ensureLoggedIn, function(request, response, next) {
    response.render('browse_snapshots', { snapshots_dir: config.get('snapshots_dir') });
});

router.get('/play', ensureLoggedIn, function(request, response, next) {
    let camera       = request.query.c;
    let playbackTime = request.query.t;

    if (!utils.isCameraNameValid(camera)) return response.sendStatus(404);

    response.render('play', {
        capture_dir       : config.get('capture_dir'),
        camera_name       : camera,
        camera_names_list : utils.getQuotedCameraNames(),
        playback_time     : playbackTime
    });
});

router.get('/recordings', ensureLoggedIn, function(request, response, next) {
    let camera = request.query.c;

    if (!utils.isCameraNameValid(camera)) return response.sendStatus(404);

    let cameraDir  = utils.getCameraCaptureDir(camera);
    let recordings = [];

    utils.getFilesSortedByDate(cameraDir, 'mp4').forEach((entry) => {
        recordings.push([
            entry[0],                               // Recording filename
            Math.round(entry[1].birthtimeMs / 1000) // Recording creation time EPOC as UTC in seconds
        ]);
    });

    let data = {};
    data["recordings"] = recordings;

    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(data));
});

router.get(/^.*$/, ensureLoggedIn, function(request, response, next) {
    logger.info('requestHandler_content');

    if (request.url == '/') {
        num_days = utils.getTotalRecordTimeDays()
        logger.info('Total record time: %f', num_days);
        return response.render('index', { total_record_time: num_days });
    }
    handleContent_all(request, response);
});

//////////////////////////////
////// Content Handlers //////
//////////////////////////////

function handleContent_all(request, response) {
    logger.info("handleContent_all: " + request.url);
    let filePath = getLocalPath(request.url);
    if (!fs.existsSync(filePath)) return response.sendStatus(404);

    if (fs.statSync(filePath).isDirectory()) {
        handleContent_dirListing(request, response, filePath);
    }
    else {
        handleContent_media(request, response, filePath);
    }
}

function handleContent_dirListing(request, response, filePath) {
    
    logger.info('Directory listing: ' + filePath);

    let files = getFiles(filePath);

    response.write('<html><head>');
    response.write('<link rel="stylesheet" href="/css/server.css">');
    response.write('</head><body><p>');

    let parentUrl = getParentUrl(request.url);
    if (parentUrl) {
        response.write('<a href="' + parentUrl + '" class="large-text">[..]</a><br><br>');
    }

    response.write('<table>');
    files.forEach((entry, i) => {
        let filename = entry[0];
        let fstat    = entry[1];
        let [date, day, time] = getDateString(fstat.birthtime).split(' ');
        let fields = [date, day, time, getSizeString(fstat.size)];

        let html = '';
        html += '<tr class="large-text"><td><a href="' + path.join(request.url, filename) + '">';
        html += (fstat.isDirectory() ? '[' + filename + ']' : filename) + '</a>&nbsp;</td>';

        for (let field of fields) {
            html += '<td>&nbsp;' + field + '</td>';
        }
        html += '</tr>';

        response.write(html);
    });
    response.write('</table>');
    response.write('</p></body></html>');
    response.end();
}

function handleContent_media(request, response, filePath) {

    logger.info('Media request: ' + filePath);

    let fileStat = fs.statSync(filePath);
    let fileSize  = fileStat.size;
    let range     = request.range(fileSize);

    let contentType = mime.lookup(filePath);
    if (!contentType) contentType = 'text/plain'; // Default response to plain text

    // If we need to provide a partial response (i.e. a chunk)
    if (range) {
        // Only look at the first byte range requested
        let start  = range[0].start;
        let end    = range[0].end;
        let length = end - start + 1;

        logger.info('Serving partial response: size=%d, bytes=%d-%d)', length, start, end);

        response.writeHead(206, {
            'Content-Range'  : `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges'  : 'bytes',
            'Content-Length' : length,
            'Content-Type'   : contentType
        });

        fs.createReadStream(filePath, {start, end}).pipe(response);
    }
    // Otherwise provide a complete response
    else {
        response.writeHead(200, {
            'Content-Length' : fileSize,
            'Content-Type'   : contentType
        });

        logger.info('Serving complete response: size=%d', fileSize);

        fs.createReadStream(filePath).pipe(response);
    }
}

///////////////////////
////// Utilities //////
///////////////////////

// Get the local path for a given URL
function getLocalPath(requestUrl) {
    let localPath = config.get('doc_root_path');
    let inPath = decodeURI(url.parse(requestUrl).pathname);

    let urlTranslation = [
        [ config.get('url_regex_capture'),   config.get('root_path') ],
        [ config.get('url_regex_snapshots'), config.get('root_path') ],
        [ config.get('url_regex_logs'),      config.get('root_path') ]
    ];

    for (let i = 0; i < urlTranslation.length; i++) {
        if (inPath.match(urlTranslation[i][0])) {
            localPath = urlTranslation[i][1];
            break;
        }
    }
    localPath = path.join(localPath, requestUrl);

    return localPath;
}

function getFiles(dirPath) {
    let allItems = [], files = [], dirs = [];
    fs.readdirSync(dirPath).forEach((filename) => {
        let fstat = fs.statSync(dirPath + '/' + filename);
        let fitem = [filename, fstat];
        if (fstat.isDirectory()) {
            dirs.push(fitem);
        }
        // Add the file if not excluded
        else if (!((filename in EXCLUDED_FILES_LOOKUP) ||
                   (path.extname(filename) in EXCLUDED_EXTS_LOOKUP))) {
            files.push(fitem);
        }
    });

    // Directories first
    let sortedDirs = utils.sortFilesByName(dirs);
    sortedDirs.forEach((x) => {
        allItems.push(x);
    });

    // Files
    let sortedFiles = utils.sortFilesByDate(files);
    sortedFiles.forEach((x) => {
        allItems.push(x);
    });

    return allItems;
}

function getDateString(d) {
    const days_of_week = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat'];
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
        + ' ' + days_of_week[d.getDay()] + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
}

function getSizeString(s) {
    return (s < 1024) ? s + ' bytes'
        : (s < (1024 * 1024)) ? (s / 1024).toFixed(1) + ' K'
            : (s < (1024 * 1024 * 1024)) ? (s / (1024 * 1024)).toFixed(1) + ' Mb'
                : (s / (1024 * 1024 * 1024)).toFixed(1) + ' Gb'
}

function getParentUrl(url) {
    let parent = path.resolve(url, '..');
    return url != parent ? parent : null;
}

module.exports = router;

