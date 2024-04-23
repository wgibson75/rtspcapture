const os             = require('os');
const fs             = require('graceful-fs');
const express        = require('express');
const https          = require('https');
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

const DEFAULT_SERVER_PORT    = 8443; // Default HTTP listening port

// Required for SSL support
const SERVER_PRIVATE_KEY     = fs.readFileSync('/auth/ssl-server.key');
const SERVER_CERTIFICATE     = fs.readFileSync('/auth/ssl-server.crt');

// Required for session cookies
const SERVER_COOKIE_SECRET   = fs.readFileSync('/auth/cookie-secret.txt');

//////////////////////////////
////// Start the server //////
//////////////////////////////

main();

function main() {
    let app         = express();
    let config_file = process.argv[2];
    let port        = isNaN(process.argv[3]) ? DEFAULT_SERVER_PORT : process.argv[3];

    config.load(config_file);
    logger.init();

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

    // Setup the routes
    app.use('/', allRouter);
    app.use('/', authRouter);
    app.use('/', snapshotRouter);
    app.use('/', contentRouter);

    const httpsOptions = {
        key:  SERVER_PRIVATE_KEY,
        cert: SERVER_CERTIFICATE
    };

    const server = https.createServer(httpsOptions, app).listen(port, () => {
        let ips = getHostIpList();

        if (ips.length == 0)
            logger.info('No network interfaces');
        else
            for (i in ips) logger.info('Listening on: https://%s:%s', ips[i], port);
    });
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
