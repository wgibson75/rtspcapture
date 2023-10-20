const os           = require('os');
const path         = require('path');
const url          = require('url');
const fs           = require('graceful-fs');
const mime         = require('mime-types');
const express      = require('express');
const spawn        = require('child_process').spawn;
const execSync     = require('child_process').execSync
const util         = require('util');

const DEFAULT_SERVER_PORT    = 8080;                          // Default HTTP listening port
const EXCLUDED_FILES         = [ 'init.mp4', '.moov_check' ]; // Filenames to exclude in directory listings
const EXCLUDED_EXTS          = [ '.m4s', '.css', '.json' ];   // Extentions of files to exclude in directory listings
const VIDEO_EXT              = 'mp4'                          // Video file extension
const LOG_FILE               = 'cctvserver-%DATE%.log'        // Log filename
const SNAPSHOT_IMAGES_FOLDER = 'images';                      // Snapshot images folder name
const SNAPSHOTS_FILE         = 'snapshots.json';              // Snapshots summary filename
const HOME_PAGE_HTML_FILE    = 'index.html';

// FFMPEG command for taking a snapshot image from camera
//
// Arguments: Username, Password, IP address, Port, Stream URL, Output JPEG file
//
const SNAPSHOT_CMD = 'ffmpeg -rtsp_transport tcp -skip_frame nokey -y -i rtsp://%s:%s@%s:%s%s -vframes 1 %s'

// FFPROBE command for getting video file duration
//
// Arguments: MPEG video file
//
const FFPROBE_DURATION_CMD = 'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 %s'

///////////////////////////////////
////// Excluded file lookups //////
///////////////////////////////////

const EXCLUDED_FILES_LOOKUP = {}, EXCLUDED_EXTS_LOOKUP = {};

EXCLUDED_FILES.forEach((x) => {
    EXCLUDED_FILES_LOOKUP[x] = true;
});

EXCLUDED_EXTS.forEach((x) => {
    EXCLUDED_EXTS_LOOKUP[x] = true;
});

///////////////////////////
////// Configuration //////
///////////////////////////

let CONFIG;
let CAMERA_CONFIG = {};
let SNAPSHOT_PATH;
let SNAPSHOT_IMAGES_PATH;

function load_config(config_file) {
    // Load the configuration file
    CONFIG = JSON.parse(fs.readFileSync(config_file, 'utf8'));

    // Build lookup for camera configuration
    CONFIG.cameras.forEach((cam, i) => {
        CAMERA_CONFIG[cam.name] = cam;
    });

    // Setup snapshot paths
    SNAPSHOT_PATH = path.join(CONFIG.doc_root_dir, CONFIG.snapshots_dir);
    SNAPSHOT_IMAGES_PATH = path.join(SNAPSHOT_PATH, SNAPSHOT_IMAGES_FOLDER);
}

///////////////////////////
////// Setup logging //////
///////////////////////////

let LOGGER;

function create_logger() {
    let { createLogger, format, transports } = require('winston');
    let { combine, printf, timestamp, splat } = format;

    let logFormat = printf(({ level, message, timestamp }) => {
      return `${timestamp} [${level}] ${message}`;
    });

    let now = new Date();
    LOGGER = createLogger({
      level: 'info',
      format: combine(splat(), timestamp(), logFormat),
      transports: [
          new transports.Console(),
          new (require('winston-daily-rotate-file'))({
              filename: path.join(CONFIG.logs_dir, LOG_FILE),
              datePattern: 'yyyy-MM-DD',
              maxFiles: '7d'
          })
      ]
    });
}

//////////////////////////////
////// Start the server //////
//////////////////////////////

main();

function main() {
    let app         = express();
    let config_file = process.argv[2];
    let port        = isNaN(process.argv[3]) ? DEFAULT_SERVER_PORT : process.argv[3];

    load_config(config_file);

    create_logger()

    // Route handlers - processed in order
    //
    let requestHandlers = [
        [ /^.*$/,           requestHandler_log        ], // Log the HTTP request
        [ /^\/server.css$/, requestHandler_stylesheet ], // CSS for directory listings
        [ /^\/snapshot$/,   requestHandler_snapshot   ], // Take a snapshot
        [ /^\/play$/,       requestHandler_playVideo  ], // Play video
        [ /^.*$/,           requestHandler_content    ]  // Request content
    ];

    requestHandlers.forEach(handler => {
        app.get(handler[0], handler[1])
    });

    app.listen(port, () => {
        let ips = getHostIpList();

        if (ips.length == 0)
            LOGGER.info('No network interfaces');
        else
            for (i in ips) LOGGER.info('Listening on: http://%s:%s', ips[i], port);
    });
}

//////////////////////////////////
////// Handlers for routing //////
//////////////////////////////////

function requestHandler_log(request, response, next) {
    LOGGER.info('%s %s', request.method, request.url);
    next(); // Call the next matching handler
}

function requestHandler_stylesheet(request, response, next) {
    LOGGER.info('requestHandler_stylesheet');
    let stylesheet = getLocalPath(request.url);
    if (!fs.existsSync(stylesheet)) return response.sendStatus(404);

    response.writeHead(200, {
        'Content-Length' : fs.statSync(stylesheet).size,
        'Content-Type'   : 'text/css'
    });
    fs.createReadStream(stylesheet).pipe(response);
}

function requestHandler_snapshot(request, response, next) {
    LOGGER.info('requestHandler_snapshot');
    response.end();

    let name = request.query.n;
    let cameras = typeof request.query.c == 'string' ? [request.query.c] : request.query.c;
    let timestamp = getTimestampNow();

    checkSnapshotDirsExist();

    if (!name || !cameras) { return; }

    let snapshots = new Array();

    cameras.forEach((cam, i) => {
        if (!(cam in CAMERA_CONFIG)) {
            LOGGER.info('No such camera: ' + cam);
            return;
        }
        let image = takeSnapshot(cam, timestamp);

        let activeRecAndPos = getActiveRecordingAndPosition(cam, timestamp);
        if (!activeRecAndPos) { return; } // Skip this camera if no active recording

        let [recording, position] = activeRecAndPos;

        // Push a tuple of snapshot image URL, recording URL and playback position
        snapshots.push([image, recording, position]);
    });

    if (snapshots.length == 0) { return; }

    createSnapshotSummary(name, timestamp, snapshots);
}

function requestHandler_playVideo(request, response, next) {
    let camera = request.query.c;
    let timestamp = request.query.t;

    LOGGER.info('requestHandler_playVideo: camera=' + camera + ', timestamp=' + timestamp);

    response.write('<html>');
    response.write('<body style="background-color: black; color: #999933; margin: 0; height: 100%">');

    let playbackFile = findVideoFile(camera, timestamp);

    if (playbackFile) {
        response.write('<script>');
        response.write('document.writeln("<video width=\'" + window.innerWidth + "\' src=\'' +
                                         playbackFile[0] + '#t=' + playbackFile[1] +
                                         '\' autoplay playsinline controls></video>")');
        response.write('</script>');
    }
    else {
        response.write('<p>Video unavailable</p>');
    }
    response.write('</body></html>');
    response.end();
}

function requestHandler_content(request, response, next) {
    LOGGER.info('requestHandler_content');
    let requestUrl = request.url.replace(/(\/)\/+/g, '$1');

    if (requestUrl == '/') requestUrl += HOME_PAGE_HTML_FILE;

    let filePath = getLocalPath(requestUrl);

    if (!fs.existsSync(filePath)) return response.sendStatus(404);

    if (fs.statSync(filePath).isDirectory()) {
        LOGGER.info('Directory listing: ' + filePath);
        handleContent_dirListing(requestUrl, filePath, response);
    }
    else {
        LOGGER.info('Media request: ' + filePath);
        handleContent_media(request, filePath, response);
    }
}

//////////////////////////////
////// Content handlers //////
//////////////////////////////

function handleContent_dirListing(requestUrl, filePath, response) {
    let files = getFiles(filePath);

    response.write('<html><head>');
    response.write('<link rel="stylesheet" href="/server.css">');
    response.write('</head><body><p>');

    let parentUrl = getParentUrl(requestUrl);
    if (parentUrl) {
        response.write('<a href="' + parentUrl + '" class="large-text">[..]</a><br><br>');
    }

    response.write('<table>');
    files.forEach((entry, i) => {
        let filename = entry[0];
        let fstat    = entry[1];
        response.write('<tr class="large-text"><td><a href="' + path.join(requestUrl, filename) + '">'
            + (fstat.isDirectory() ? '[' + filename + ']' : filename) + '</a></td><td>&nbsp;&nbsp;'
            + getDateString(fstat.mtime) + '</td><td>&nbsp;&nbsp;'
            + getSizeString(fstat.size) + '</td></tr>');
    });
    response.write('</table>');
    response.write('</p></body></html>');
    response.end();
}

function handleContent_media(request, filePath, response) {
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

        LOGGER.info('Serving partial response: size=%d, bytes=%d-%d)', length, start, end);

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

        LOGGER.info('Serving complete response: size=%d', fileSize);

        fs.createReadStream(filePath).pipe(response);
    }
}

///////////////////////
////// Utilities //////
///////////////////////

function runCommandSync(cmd) {
    let result = undefined;
    LOGGER.info('Running command: ' + cmd);
    try {
        result = execSync(cmd);
    }
    catch(error) {
        LOGGER.error(error.stderr.toString());
    }
    return result;
}

function getVideoFileDurationMs(videoFile) {
    let duration = 0;
    let cmd = util.format(FFPROBE_DURATION_CMD, videoFile);
    let output = runCommandSync(cmd);

    if (output) duration = parseFloat(output) * 1000;
    return duration;
}

function getActiveRecordingAndPosition(camera, timestampNow) {
    let cameraDir = path.join(CONFIG.capture_dir, camera);

    if (!fs.existsSync(cameraDir)) {
        LOGGER.error('Directory does not exist: ' + cameraDir);
        return;
    }

    let files = [];
    let regex = new RegExp('.*\.' + VIDEO_EXT);
    fs.readdirSync(cameraDir).forEach((filename) => {
        if (!filename.match(regex)) {
            return;
        }
        let fstat = fs.statSync(cameraDir + '/' + filename);
        files.push([filename, fstat]);
    });

    if (files.length == 0) {
        LOGGER.error('No video files in: ' + cameraDir);
        return;
    }

    let sortedFiles  = sortFilesByDate(files);
    let [activeFile, previousFile] = sortedFiles.slice(0, 2);
    let position = 0; // Report zero position if cannot determine position

    // Determine the current position using the last
    // modified time of the previous video file
    if (previousFile) {
        let fstat = previousFile[1];
        // Report position in seconds
        position = Math.floor((timestampNow - fstat.mtime.getTime()) / 1000);
    }
    let recordingUrl = path.join('/', CONFIG.video_dir, camera, activeFile[0]);

    return [recordingUrl, position];
}

function findVideoFile(camera, timestamp) {
    let cameraDir = path.join(CONFIG.capture_dir, camera);

    if (!fs.existsSync(cameraDir)) {
        LOGGER.error('Directory does not exist: ' + cameraDir);
        return;
    }

    let files = [];
    let regex = new RegExp('.*\.' + VIDEO_EXT);
    fs.readdirSync(cameraDir).forEach((filename) => {
        if (!filename.match(regex)) {
            return;
        }
        let fstat = fs.statSync(cameraDir + '/' + filename);
        files.push([filename, fstat]);
    });

    if (files.length == 0) {
        LOGGER.error('No video files in: ' + cameraDir);
        return;
    }

    let sortedFiles = sortFilesByDate(files);

    // Walk through all videos in reverse chronological order by last modified date
    for (let i = 0; i < sortedFiles.length; i++) {
        let fstat = sortedFiles[i][1];

        if (fstat.mtime.getTime() < timestamp) {
            if (i == 0) return;

            // Take the previous video file as this must have our timestamp
			let [filename, filestat] = sortedFiles[i - 1];

            LOGGER.info('timestamp ' + timestamp + ' must be in ' + filename);

            let filepath = path.join(cameraDir, filename);
            let duration = getVideoFileDurationMs(filepath);

            LOGGER.info('duration of video is ' + duration + 'ms');

            if (duration == 0) return;

            // Calculate the playback position based on the last modified time
            // being roughly the same as the timestamp at the end of the video
            let videoStartTime = filestat.mtime - duration;
            let playbackTime = timestamp - videoStartTime;

            if (videoStartTime > timestamp) return;

            LOGGER.info('Playback position is ' + playbackTime + 'ms');

            return [path.join(CONFIG.video_dir, camera, filename), Math.round(playbackTime/1000)];
            break;
        }
    }
}

function deleteSnapshot(filename) {
    let summaryPath = path.join(SNAPSHOT_PATH, filename);
    LOGGER.info('Deleting: ' + summaryPath);
    fs.unlinkSync(summaryPath);

    let snapshotId = filename.replace(/^([0-9]+).*$/, "$1");
    let imageRegex = new RegExp('^' + snapshotId + '_.*$');

    fs.readdirSync(SNAPSHOT_IMAGES_PATH).forEach((filename) => {
        if (filename.match(imageRegex)) {
            let imagePath = path.join(SNAPSHOT_IMAGES_PATH, filename);
            LOGGER.info('Deleting: ' + imagePath);
            fs.unlinkSync(imagePath);
        }
    })
}

function getFilenamesSortedByDate(dirPath, ext) {
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
    return sortFilesByDate(files).map((entry) => entry[0]);
}

// This will also enforce maximum snapshots by deleting oldest snapshots
function createSnapshotsFile() {
    let files = getFilenamesSortedByDate(SNAPSHOT_PATH, 'html');

    while (files.length > CONFIG.max_num_snapshots) {
        deleteSnapshot(files.pop());
    }

    let data = {};
    data.snapshots = files;

    let jsonFile = path.join(SNAPSHOT_PATH, SNAPSHOTS_FILE);
    LOGGER.info('Creating: ' + jsonFile);
    fs.writeFileSync(jsonFile, JSON.stringify(data, null, 4));
}

function getTimestampNow() {
    let date = new Date()
    return date.getTime();
}

function checkSnapshotDirsExist() {
    if (!fs.existsSync(SNAPSHOT_PATH)) {
        fs.mkdirSync(SNAPSHOT_PATH);
    }
    if (!fs.existsSync(SNAPSHOT_IMAGES_PATH)) {
        fs.mkdirSync(SNAPSHOT_IMAGES_PATH);
    }
}

function buildSnapshotImgPath(timestamp, camera) {
    return path.join(SNAPSHOT_IMAGES_PATH, util.format('%s_%s.jpg', timestamp, camera));
}

function takeSnapshot(camera, timestamp) {
    let config = CAMERA_CONFIG[camera];

    let username = config.username;
    let password = config.password;
    let ip       = config.ip;
    let port     = config.port;
    let stream   = config.streams[0].path; // Take first highest quality stream

    let snapshotFile = buildSnapshotImgPath(timestamp, camera);
    let cmd = util.format(SNAPSHOT_CMD, username, password, ip, port, stream, snapshotFile);

    let args = cmd.split(' ');
    let exec = args.shift();

    LOGGER.info('Taking snapshot: ' + snapshotFile);
    let cmdSpawn = spawn(exec, args, {
        detached: true
    });

    cmdSpawn.on('close', (code, signal) => {
        if (code == 0) return;
        LOGGER.info('Snapshot failed: ' + camera);
    });

    return path.basename(snapshotFile);
}

function createSnapshotSummary(name, timestamp, snapshots) {
    let data = `<html>
    <head><title>Video Snapshot</title></head>
    <body style="background-color: black; margin: 0; height: 100%" id="body">
    <div style="font-size: 0" id="main">
    <script>
    function playVideo(url, positionSecs) {
        let body = document.getElementById('body');
        let main = document.getElementById('main');

        let video = document.createElement('video');
        video.setAttribute('width', window.innerWidth);
        video.setAttribute('src', url + '#t=' + positionSecs);
        video.setAttribute('autoplay', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('controls', '');

        body.replaceChild(video, main);
        
        // Have to delay setting the click handler otherwise it will
        // fire instantly for the click that triggered this call
        setTimeout(setClickHandler, 100);
    }

    function setClickHandler() {
        document.addEventListener("click", onClickHandler);
    }

    function onClickHandler(e) {
        let maxY = window.innerHeight * 0.25;

        // Only reload if clicked in top quarter of screen
        if (e.clientY < maxY) {
            location.reload();
        }
    }
    \n`;

    data += 'let imageWidth = ' + ((snapshots.length > 1) ? 'Math.floor(window.innerWidth / 2)' : 'window.innerWidth') + ';';

    snapshots.forEach((entry, i) => {
        let [imageFile, videoUrl, position] = entry;
        let imageUrl = path.join(SNAPSHOT_IMAGES_FOLDER, imageFile);

        data += `document.writeln('<a onclick="playVideo('
            + "'${videoUrl}', ${position}"
            + ')"><img src="${imageUrl}" width='
            + imageWidth
            + '></a>');\n`;
    });

    data += `</script>
    </div></body>
    </html>`;

    let summaryFile = path.join(SNAPSHOT_PATH, util.format('%s_%s.html', name, timestamp));
    LOGGER.info('Creating: ' + summaryFile);
    fs.writeFileSync(summaryFile, data);

    createSnapshotsFile();
}

function getDateString(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
        + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
}

function getSizeString(s) {
    return (s < 1024) ? s + ' bytes'
        : (s < (1024 * 1024)) ? (s / 1024).toFixed(1) + ' K'
            : (s < (1024 * 1024 * 1024)) ? (s / (1024 * 1024)).toFixed(1) + ' Mb'
                : (s / (1024 * 1024 * 1024)).toFixed(1) + ' Gb'
}
function sortFilesByDate(fitems) {
    let sortedFiles = fitems.sort((a, b) => {
        let aStat = a[1], bStat = b[1];
        return new Date(bStat.mtime).getTime() - new Date(aStat.mtime).getTime();
    });
    return sortedFiles;
}

function sortFilesByName(fitems) {
    let sortedFiles = fitems.sort((a, b) => {
        let aName = a[0], bName = b[0];
        return aName.localeCompare(bName, 'en', { numeric: true });
    });
    return sortedFiles;
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
    let sortedDirs = sortFilesByName(dirs);
    sortedDirs.forEach((x) => {
        allItems.push(x);
    });

    // Files
    let sortedFiles = sortFilesByDate(files);
    sortedFiles.forEach((x) => {
        allItems.push(x);
    });

    return allItems;
}

function getParentUrl(url) {
    let parent = path.resolve(url, '..');
    return url != parent ? parent : null;
}

// Get the local path for a given URL
function getLocalPath(requestedUrl) {
    return path.join(CONFIG.doc_root_dir, decodeURI(url.parse(requestedUrl).pathname)).replace(/\/$/, '');
}

// Get a list of IPv4 host IP addresses.
function getHostIpList() {
    let rval = [];
    let nifList  = os.networkInterfaces();

    for (let nif in nifList) {
        for (let i in nifList[nif]) {
            if (nifList[nif][i]['family'] === 'IPv4') {
                rval.push(nifList[nif][i]['address']);
            }
        }
    }
    return rval;
}
