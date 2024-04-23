const express = require('express');
const path    = require('path');
const fs      = require('graceful-fs');
const spawn   = require('child_process').spawn;
const util    = require('util');

const utils  = require('../utils');
const config = require('../config');
const logger = require('../logger');

const VIDEO_EXT              = 'mp4';            // Video file extension
const SNAPSHOTS_FILE         = 'snapshots.json'; // Snapshots summary filename

// FFMPEG command for taking a snapshot image from camera
//
// Arguments: Username, Password, IP address, Port, Stream URL, Output JPEG file
//
const SNAPSHOT_CMD = 'ffmpeg -rtsp_transport tcp -skip_frame nokey -y -i rtsp://%s:%s@%s:%s%s -vframes 1 %s'

////////////////////
////// Router //////
////////////////////

const router = express.Router();

router.get(/^\/snapshot$/, function(request, response, next) {
    logger.info('requestHandler_snapshot');
    response.end();

    let name = request.query.n;
    let cameras = typeof request.query.c == 'string' ? [request.query.c] : request.query.c;
    let timestamp = utils.getTimestampNow();

    checkSnapshotDirsExist();

    if (!name || !cameras) { return; }

    let snapshots = new Array();

    cameras.forEach((cam, i) => {
        if (!(cam in config.get('camera_config'))) {
            logger.info('No such camera: ' + cam);
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
});

function checkSnapshotDirsExist() {
    let snapshotPath = config.get('snapshot_path');
    if (!fs.existsSync(snapshotPath)) fs.mkdirSync(snapshotPath);

    let snapshotImagesPath = config.get('snapshot_images_path');
    if (!fs.existsSync(snapshotImagesPath)) fs.mkdirSync(snapshotImagesPath);
}

function takeSnapshot(camera, timestamp) {
    let cameraConfig = config.get('camera_config')[camera];

    let username = cameraConfig.username;
    let password = cameraConfig.password;
    let ip       = cameraConfig.ip;
    let port     = cameraConfig.port;
    let stream   = cameraConfig.streams[0].path; // Take first highest quality stream

    let snapshotFile = buildSnapshotImgPath(timestamp, camera);
    let cmd = util.format(SNAPSHOT_CMD, username, password, ip, port, stream, snapshotFile);

    let args = cmd.split(' ');
    let exec = args.shift();

    logger.info('Taking snapshot: ' + cmd);
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

function getActiveRecordingAndPosition(camera, timestampNow) {
    let cameraDir = path.join(config.get('root_path'), config.get('capture_dir'), camera);

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

    let sortedFiles  = utils.sortFilesByDate(files);
    let [activeFile, previousFile] = sortedFiles.slice(0, 2);
    let position = 0; // Report zero position if cannot determine position

    // Determine the current position using the last
    // modified time of the previous video file
    if (previousFile) {
        let fstat = previousFile[1];
        // Report position in seconds
        position = Math.floor((timestampNow - fstat.mtime.getTime()) / 1000);
    }
    let recordingUrl = path.join('/', config.get('capture_dir'), camera, activeFile[0]);

    return [recordingUrl, position];
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

            // Pass focus back to top level page via snapshot filter
            top.document.getElementById('filterSelect').focus();
            top.document.getElementById('filterSelect').blur();
        }
    }
    \n`;

    data += 'let imageWidth = "' + ((snapshots.length > 1) ? '50%' : '100%') + '";';

    snapshots.forEach((entry, i) => {
        let [imageFile, videoUrl, position] = entry;
        let imageUrl = path.join(config.get('snapshot_images_dir'), imageFile);

        data += `document.writeln('<a onclick="playVideo('
            + "'${videoUrl}', ${position}"
            + ')"><img src="${imageUrl}" width="'
            + imageWidth
            + '"></a>');\n`;
    });

    data += `</script>
    </div></body>
    </html>`;

    let summaryFile = path.join(config.get('snapshot_path'), util.format('%s_%s.html', name, timestamp));
    logger.info('Creating: ' + summaryFile);
    fs.writeFileSync(summaryFile, data);

    createSnapshotsFile();
}

// This will also enforce maximum snapshots by deleting oldest snapshots
function createSnapshotsFile() {
    let snapshotPath = config.get('snapshot_path');
    let maxSnapshots = config.get('max_num_snapshots');

    let files = utils.getFilenamesSortedByDate(snapshotPath, 'html');

    while (files.length > maxSnapshots) {
        deleteSnapshot(files.pop());
    }

    let data = {};
    data.snapshots = files;

    let jsonFile = path.join(snapshotPath, SNAPSHOTS_FILE);
    logger.info('Creating: ' + jsonFile);
    fs.writeFileSync(jsonFile, JSON.stringify(data, null, 4));
}

function deleteSnapshot(filename) {
    let summaryPath = path.join(config.get('snapshot_path'), filename);
    logger.info('Deleting: ' + summaryPath);
    fs.unlinkSync(summaryPath);

    let snapshotId = filename.replace(/^([0-9]+).*$/, "$1");
    let imageRegex = new RegExp('^' + snapshotId + '_.*$');
    let imagesPath = config.get('snapshot_images_path');

    fs.readdirSync(imagesPath).forEach((filename) => {
        if (filename.match(imageRegex)) {
            let imagePath = path.join(imagesPath, filename);
            logger.info('Deleting: ' + imagePath);
            fs.unlinkSync(imagePath);
        }
    })
}

function buildSnapshotImgPath(timestamp, camera) {
    return path.join(config.get('snapshot_images_path'), util.format('%s_%s.jpg', timestamp, camera));
}

module.exports = router;