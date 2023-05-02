const os      = require('os');
const path    = require('path');
const url     = require('url');
const fs      = require('graceful-fs');
const mime    = require('mime-types');
const express = require('express');
const spawn   = require('child_process').spawn;
const util    = require('util');

const DEFAULT_SERVER_PORT  = 8080;                    // Default HTTP listening port
const CONFIG_FILE          = '/usr/local/bin/config.json';
const EXCLUDED_FILES       = [ 'init.mp4' ];          // Filenames to exclude in directory listings
const EXCLUDED_EXTS        = [ '.m4s', '.css' ];      // Extentions of files to exclude in directory listings
const MAX_NUM_SNAPSHOTS    = 100;                     // Maximum number of snapshots (oldest will be deleted)

// FFMPEG command for taking a snapshot image from camera
//
// Arguments: Username, Password, IP address, Port, Stream URL, Output JPEG file
//
const SNAPSHOT_CMD = 'ffmpeg -rtsp_transport tcp -skip_frame nokey -y -i rtsp://%s:%s@%s:%s%s -vframes 1 %s'

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

const logger = createLogger({
  level: 'info',
  format: combine(splat(), timestamp(), logFormat),
  transports: [ new transports.Console() ]
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
        [ /^.*$/,           requestHandler_content    ], // Request content
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

    let cameras = typeof request.query.c == 'string' ? [request.query.c] : request.query.c;
    let timestamp = getTimestampNow();

    checkSnapshotDirsExist();

    if (!cameras) { return; }

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

    createSnapshotSummary(timestamp, snapshots);
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

    if (files.length > MAX_NUM_SNAPSHOTS) {
        let sortedFiles = sortFilesByDate(files);
        let deleteFiles = sortedFiles.slice(MAX_NUM_SNAPSHOTS);

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

function createSnapshotSummary(timestamp, images) {
    let data = '<html><head>';
    data += '<link rel="stylesheet" href="/server.css">';
    data += '</head><body><p>';

    images.forEach((entry, i) => {
        let imageUrl = path.join(SNAPSHOT_IMAGES_FOLDER, entry);
        data += ('<a href="' + imageUrl + '"><img width="1024" src="' + imageUrl + '"></a><br>');
    });
    data += '</p></body></html>';

    let summaryFile = path.join(SNAPSHOT_PATH, util.format('%s.html', timestamp));
    logger.info('Creating: ' + summaryFile);
    fs.writeFileSync(summaryFile, data);

    enforceMaxSnapshots();
}

function getDateString(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
        + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
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
        return new Date(bStat.birthtime).getTime() - new Date(aStat.birthtime).getTime();
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
