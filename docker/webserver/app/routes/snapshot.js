const express = require('express');
const path    = require('path');
const fs      = require('graceful-fs');
const spawn   = require('child_process').spawn;
const util    = require('util');
const ejs     = require('ejs');

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

        let imageFile = takeSnapshot(cam, timestamp);

        // Push a tuple of snapshot image URL, camera name and timestamp
        snapshots.push([imageFile, cam]);
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

function createSnapshotSummary(name, timestamp, snapshots) {
    var file = path.join(config.get('snapshot_path'), util.format('%s_%s.html', name, timestamp));

    logger.info('Creating: ' + file);
    var entries = [];
    snapshots.forEach((entry) => {
        let [imageFile, camera] = entry;
        let imageUrl = path.join(config.get('snapshot_images_dir'), imageFile);
        entries.push({ imageUrl: imageUrl, camera: camera, timestamp: timestamp });
    });
    var template = fs.readFileSync('views/snapshot.ejs', 'utf-8');
    var html     = ejs.render (template , { entries: entries });
    fs.writeFileSync(file, html, 'utf8');
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