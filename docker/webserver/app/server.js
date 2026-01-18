const os             = require('os');
const fs             = require('graceful-fs');
const express        = require('express');
const https          = require('https');
const http           = require('http');
const path           = require('path');

const cookieParser   = require('cookie-parser');
const session        = require('express-session');
const csrf           = require('csurf');
const passport       = require('passport');
const sqliteStore    = require('connect-sqlite3')(session);

const config         = require('./config');
const logger         = require('./logger');
const allRouter      = require('./routes/all');
const authRouter     = require('./routes/auth');
const snapshotRouter = require('./routes/snapshot');
const contentRouter  = require('./routes/content');

const DEFAULT_SECURE_PORT     = 8443; // Default HTTPS listening port
const DEFAULT_NON_SECURE_PORT = 8080; // Default HTTP listening port

// Required for SSL support
const SERVER_PRIVATE_KEY = fs.readFileSync('/auth/ssl-server.key');
const SERVER_CERTIFICATE = fs.readFileSync('/auth/ssl-server.crt');

// Required for session cookies
const SERVER_COOKIE_SECRET = fs.readFileSync('/auth/cookie-secret.txt');

//////////////////////////////
////// Start the server //////
//////////////////////////////

main();

function main() {
    // Load the configuration
    let config_file = process.argv[2];
    config.load(config_file);

    // Initialise our logger
    logger.init();

    ////
    // Secure express app
    //////////////////////

    let app = create_app();

    app.use('/', allRouter);
    app.use('/', authRouter);
    app.use('/', contentRouter);

    const port = isNaN(process.argv[3]) ? DEFAULT_SECURE_PORT : process.argv[3];
    create_server(app, port, true);

    ////
    // Non-secure express app
    //////////////////////////

    let ns_app = create_app();

    ns_app.use('/', allRouter);
    ns_app.use('/', snapshotRouter); // For triggering snapshots
    ns_app.use('/', authRouter);
    ns_app.use('/', contentRouter);

    const ns_port = isNaN(process.argv[4]) ? DEFAULT_NON_SECURE_PORT : process.argv[4];
    create_server(ns_app, ns_port, false);
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

// Create an application instance
function create_app() {
    let app = express();

    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');

    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    app.use(cookieParser());
    app.use(session({
        secret: SERVER_COOKIE_SECRET,
        resave: false,
        saveUninitialized: false,
        store: new sqliteStore({ db: 'sessions.db', dir: './var/db' })
    }));
    app.use(csrf());
    app.use(passport.authenticate('session'));
    app.use(function(req, res, next) {
      var msgs = req.session.messages || [];
      res.locals.messages = msgs;
      res.locals.hasMessages = !! msgs.length;
      req.session.messages = [];
      next();
    });
    app.use(function(req, res, next) {
      res.locals.csrfToken = req.csrfToken();
      next();
    });

    return app;
}

// Create a server instance for the supplied application on a given port
function create_server(app, port, isSecure) {
    connected_cb = () => {
        let ips = getHostIpList();

        for (i in ips) logger.info('Listening on: https://%s:%s', ips[i], port);
        if (ips.length == 0) logger.info('No network interfaces on port %s', port);
    }

    const httpsOptions = {
        key:  SERVER_PRIVATE_KEY,
        cert: SERVER_CERTIFICATE
    };

    const server = isSecure ? https.createServer(httpsOptions, app).listen(port, connected_cb)
                            : http.createServer(app).listen(port, connected_cb);
}
