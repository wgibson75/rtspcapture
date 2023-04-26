const os      = require('os');
const path    = require('path');
const url     = require('url');
const fs      = require('graceful-fs');
const mime    = require('mime-types');
const express = require('express');

const DEFAULT_SERVER_PORT = 8080;           // Default HTTP listening port
const CONFIG_FILE         = '/usr/local/bin/config.json';
const EXCLUDED_FILES      = [ 'init.mp4' ]; // Filenames to exclude
const EXCLUDED_EXTS       = [ '.m4s' ];     // Extentions of files to exclude

// Read the configuration
const CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

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
    let stylesheet = getLocalPath(request.url);
    if (!fs.existsSync(stylesheet)) return response.sendStatus(404);

    response.writeHead(200, {
        'Content-Length' : fs.statSync(stylesheet).size,
        'Content-Type'   : 'text/css'
    });
    fs.createReadStream(stylesheet).pipe(response);
}

function requestHandler_content(request, response, next) {
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

function sortFilesByDate(dirPath, fitems) {
    let sortedFiles = fitems.sort((a, b) => {
        let aStat = a[1], bStat = b[1];
        return new Date(bStat.birthtime).getTime() - new Date(aStat.birthtime).getTime();
    });
    return sortedFiles;
}

function sortFilesByName(dirPath, fitems) {
    let sortedFiles = fitems.sort((a, b) => {
        let aName = a[0], bName = b[0];
        return aName.localeCompare(bName, 'en', { numeric: true });
    });
    return sortedFiles;
}

function getFiles(dirPath) {
    let allItems = [], files = [], dirs = [];
    fs.readdirSync(dirPath).forEach((filename) => {
        var fstat = fs.statSync(dirPath + '/' + filename);
        var fitem = [filename, fstat];
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
    let sortedDirs = sortFilesByName(dirPath, dirs);
    sortedDirs.forEach((x) => {
        allItems.push(x);
    });

    // Files
    let sortedFiles = sortFilesByDate(dirPath, files);
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
    let nif_list  = os.networkInterfaces();

    for (let nif in nif_list) {
        for (let i in nif_list[nif]) {
            if (nif_list[nif][i]['family'] === 'IPv4') {
                rval.push(nif_list[nif][i]['address']);
            }
        }
    }
    return rval;
}
