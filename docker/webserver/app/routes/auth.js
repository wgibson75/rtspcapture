const express       = require('express');
const passport      = require('passport');
const LocalStrategy = require('passport-local');
const crypto        = require('crypto');
const db            = require('../db');
const logger        = require('../logger');

passport.use(new LocalStrategy(function verify(username, password, cb) {
  db.get('SELECT * FROM users WHERE username = ?', [ username ],
    function(err, row) {
      if (err)  return cb(err);

      if (!row) {
        logger.warn('LOGIN FAILED: No such user (' + username + ')');
        return cb(null, false, { message: 'Incorrect username or password.' });
      }

      crypto.pbkdf2(password, row.salt, 310000, 32, 'sha256',
        function(err, hashedPassword) {
          if (err) return cb(err);

          if (!crypto.timingSafeEqual(row.hashed_password, hashedPassword)) {
            logger.warn('LOGIN FAILED: Incorrect password for user (' + username + ')');
            return cb(null, false, { message: 'Incorrect username or password.' });
          }
          return cb(null, row);
        });
    });
}));

passport.serializeUser(function(user, cb) {
  process.nextTick(function() {
    cb(null, { id: user.id, username: user.username });
  });
});

passport.deserializeUser(function(user, cb) {
  process.nextTick(function() {
    return cb(null, user);
  });
});

var router = express.Router();

router.get('/login', function(request, response, next) {
  response.render('login');
});

router.post('/login/password', passport.authenticate('local', {
  successReturnToOrRedirect: '/',
  failureRedirect: '/login',
  failureMessage: true
}));

router.post('/logout', function(request, response, next) {
  request.logout(
    function(err) {
      if (err) {
        logger.error(err);
        return next(err);
      }
      response.redirect('/');
    });
});

router.post('/signup', function(request, response, next) {
  logger.info('Signup user (' + request.body.uid + ')');

  var salt = crypto.randomBytes(16);
  crypto.pbkdf2(request.body.password, salt, 310000, 32, 'sha256',
    function(err, hashedPassword) {
      if (err) return next(err);

      db.run('INSERT INTO users (username, hashed_password, salt) VALUES (?, ?, ?)', [
        request.body.username,
        hashedPassword,
        salt
      ],
      function(err) {
        if (err) {
          logger.error(err);
          if (String(err).match(/UNIQUE constraint failed/)) err = "Username already exists";
          return response.render('signup', { message: err });
        }
        var user = {
          id: this.lastID,
          username: request.body.username
        };
        request.login(user, function(err) {
          if (err) { return next(err); }
          response.redirect('/');
        });
      });
    });
});

router.post('/delete', function(request, response, next) {
  logger.info('Delete user (' + request.body.uid + ')');

  db.run('DELETE FROM users WHERE username=?', [request.body.uid]);
  response.redirect('/accounts')
});

module.exports = router;
