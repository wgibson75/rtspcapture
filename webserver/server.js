const os           = require('os');
const path         = require('path');
const url          = require('url');
const fs           = require('graceful-fs');
const mime         = require('mime-types');
const express      = require('express');
const spawn        = require('child_process').spawn;
const execSync     = require('child_process').execSync
const util         = require('util');

const DEFAULT_SERVER_PORT  = 8080;                          // Default HTTP listening port
const CONFIG_FILE          = '/usr/local/bin/config.json';  // JSON configuration file
const EXCLUDED_FILES       = [ 'init.mp4', '.moov_check' ]; // Filenames to exclude in directory listings
const EXCLUDED_EXTS        = [ '.m4s', '.css', '.json' ];   // Extentions of files to exclude in directory listings
const VIDEO_EXT            = 'mp4'                          // Video file extension
const LOG_FILE             = 'cctvserver-%DATE%.log'        // Log filename

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

// Read the configuration
const CONFIG        = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const CAMERA_CONFIG = {};

// Build lookup for camera configuration
CONFIG.cameras.forEach((cam, i) => {
    CAMERA_CONFIG[cam.name] = cam;
});

const SNAPSHOT_IMAGES_FOLDER = 'images';
const SNAPSHOT_PATH          = path.join(CONFIG.doc_root_dir, CONFIG.snapshots_dir);
const SNAPSHOT_IMAGES_PATH   = path.join(SNAPSHOT_PATH, SNAPSHOT_IMAGES_FOLDER);

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
////// Setup logging //////
///////////////////////////

const { createLogger, format, transports } = require('winston');
const { combine, printf, timestamp, splat } = format;

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}] ${message}`;
});

const now = new Date();
const logger = createLogger({
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

//////////////////////////////
////// Start the server //////
//////////////////////////////

main();

function main() {
    const app  = express();
    const port = isNaN(process.argv[2]) ? DEFAULT_SERVER_PORT : process.argv[2];

    // Route handlers - processed in order
    //
    const requestHandlers = [
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
        const ips = getHostIpList();

        if (ips.length == 0)
            logger.info('No network interfaces');
        else
            for (i in ips) logger.info('Listening on: http://%s:%s', ips[i], port);
    });
}

//////////////////////////////////
////// Handlers for routing //////
//////////////////////////////////

function requestHandler_log(request, response, next) {
    logger.info('%s %s', request.method, request.url);
    next(); // Call the next matching handler
}

function requestHandler_stylesheet(request, response, next) {
    logger.info('requestHandler_stylesheet');
    let stylesheet = getLocalPath(request.url);
    if (!fs.existsSync(stylesheet)) return response.sendStatus(404);

    response.writeHead(200, {
        'Content-Length' : fs.statSync(stylesheet).size,
        'Content-Type'   : 'text/css'
    });
    fs.createReadStream(stylesheet).pipe(response);
}

function requestHandler_snapshot(request, response, next) {
    logger.info('requestHandler_snapshot');
    response.end();

    let name = request.query.n;
    let cameras = typeof request.query.c == 'string' ? [request.query.c] : request.query.c;
    let timestamp = getTimestampNow();

    checkSnapshotDirsExist();

    if (!name || !cameras) { return; }

    let snapshots = new Array();

    cameras.forEach((cam, i) => {
        if (!(cam in CAMERA_CONFIG)) {
            logger.info('No such camera: ' + cam);
            return;
        }
        let image = takeSnapshot(cam, timestamp);
        snapshots.push(image);
    });

    if (snapshots.length == 0) { return; }

    createSnapshotSummary(name, timestamp, snapshots);
}

function requestHandler_playVideo(request, response, next) {
    let camera = request.query.c;
    let timestamp = request.query.t;

    logger.info('requestHandler_playVideo: camera=' + camera + ', timestamp=' + timestamp);

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
    logger.info('requestHandler_content');
    let requestUrl = request.url.replace(/(\/)\/+/g, '$1');
    let filePath = getLocalPath(requestUrl);

    if (!fs.existsSync(filePath)) return response.sendStatus(404);

    if (fs.statSync(filePath).isDirectory()) {
        logger.info('Directory listing: ' + filePath);
        handleContent_dirListing(requestUrl, filePath, response);
    }
    else {
        logger.info('Media request: ' + filePath);
        handleContent_media(request, filePath, response);
    }
}

//////////////////////////////
////// Content handlers //////
//////////////////////////////

function handleContent_dirListing(requestUrl, filePath, response) {
    const files = getFiles(filePath);

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
    const fileStat = fs.statSync(filePath);
    const fileSize  = fileStat.size;
    const range     = request.range(fileSize);

    let contentType = mime.lookup(request.url);
    if (!contentType) contentType = 'text/plain'; // Default response to plain text

    // If we need to provide a partial response (i.e. a chunk)
    if (range) {
        // Only look at the first byte range requested
        const start  = range[0].start;
        const end    = range[0].end;
        const length = end - start + 1;

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

function runCommandSync(cmd) {
    let result = undefined;
    logger.info('Running command: ' + cmd);
    try {
        result = execSync(cmd);
    }
    catch(error) {
        logger.error(error.stderr.toString());
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

function findVideoFile(camera, timestamp) {
    let cameraDir = path.join(CONFIG.capture_dir, camera);

    if (!fs.existsSync(cameraDir)) {
        logger.error('Directory does not exist: ' + cameraDir);
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
        logger.error('No video files in: ' + cameraDir);
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

            logger.info('timestamp ' + timestamp + ' must be in ' + filename);

            let filepath = path.join(cameraDir, filename);
            let duration = getVideoFileDurationMs(filepath);

            logger.info('duration of video is ' + duration + 'ms');

            if (duration == 0) return;

            // Calculate the playback position based on the last modified time
            // being roughly the same as the timestamp at the end of the video
            let videoStartTime = filestat.mtime - duration;
            let playbackTime = timestamp - videoStartTime;

            if (videoStartTime > timestamp) return;

            logger.info('Playback position is ' + playbackTime + 'ms');

            return [path.join(CONFIG.video_dir, camera, filename), Math.round(playbackTime/1000)];
            break;
        }
    }
}

function deleteSnapshot(filename) {
    let summaryPath = path.join(SNAPSHOT_PATH, filename);
    logger.info('Deleting: ' + summaryPath);
    fs.unlinkSync(summaryPath);

    let snapshotId = filename.replace(/^([0-9]+).*$/, "$1");
    let imageRegex = new RegExp('^' + snapshotId + '_.*$');

    fs.readdirSync(SNAPSHOT_IMAGES_PATH).forEach((filename) => {
        if (filename.match(imageRegex)) {
            let imagePath = path.join(SNAPSHOT_IMAGES_PATH, filename);
            logger.info('Deleting: ' + imagePath);
            fs.unlinkSync(imagePath);
        }
    })
}

function enforceMaxSnapshots() {
    let files = [];
    fs.readdirSync(SNAPSHOT_PATH).forEach((filename) => {
        let fstat = fs.statSync(SNAPSHOT_PATH + '/' + filename);
        let fitem = [filename, fstat];

        if ((filename.charAt() == '.') || (fstat.isDirectory())) {
            return;
        }
        files.push(fitem);
    });

    if (files.length > CONFIG.max_num_snapshots) {
        let sortedFiles = sortFilesByDate(files);
        let deleteFiles = sortedFiles.slice(CONFIG.max_num_snapshots);

        deleteFiles.forEach((entry, i) => {
            deleteSnapshot(entry[0]);
        });
    }
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

    logger.info('Taking snapshot: ' + snapshotFile);
    let cmdSpawn = spawn(exec, args, {
        detached: true
    });

    cmdSpawn.on('close', (code, signal) => {
        if (code == 0) return;
        logger.info('Snapshot failed: ' + camera);
    });

    return path.basename(snapshotFile);
}

function createSnapshotSummary(name, timestamp, images) {
    let data = '<html>';
    data += '<head><title>Video Snapshot</title></head>';
    data += '<body style="background-color: black; margin: 0; height: 100%">';
    data += '<div style="font-size: 0">';
    data += '<script>';

    images.forEach((entry, i) => {
        let match = entry.match(/^(\d+)_(.*?)\.jpg$/);
        let timestamp = match[1];
        let camera = match[2];
        let imageUrl = path.join(SNAPSHOT_IMAGES_FOLDER, entry);
        let imageTag = images.length > 1
            ? '<img width="\' + Math.floor(window.innerWidth / 2) + \'" src="' + imageUrl + '">'
            : '<img width="\' + window.innerWidth + \'" src="' + imageUrl + '">'
        data += ('document.writeln(\'<a href="/play?c=' + camera + '&t=' + timestamp + '">' + imageTag + '</a>\');');
    });

    data += '</script>';
    data += '</div>';
    data += '</body>';
    data += '</html>';

    let summaryFile = path.join(SNAPSHOT_PATH, util.format('%s_%s.html', name, timestamp));
    logger.info('Creating: ' + summaryFile);
    fs.writeFileSync(summaryFile, data);

    enforceMaxSnapshots();
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
