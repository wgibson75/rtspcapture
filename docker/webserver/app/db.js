var sqlite3 = require('sqlite3');
var mkdirp = require('mkdirp');
var crypto = require('crypto');

const DEFAULT_USERNAME = "monkey";
const DEFAULT_PASSWORD = "monkeypoo";

mkdirp.sync('./var/db');

var db = new sqlite3.Database('./var/db/users.db');

db.serialize(function() {
  // Create the schema for storing users
  db.run("CREATE TABLE IF NOT EXISTS users ( \
    id INTEGER PRIMARY KEY, \
    username TEXT UNIQUE, \
    hashed_password BLOB, \
    salt BLOB \
  )");

  db.get('SELECT COUNT(*) AS count FROM users', (err, row) => {
    // If no users, create the initial default user
    if (row.count == 0) {
      var salt = crypto.randomBytes(16);
      db.run('INSERT OR IGNORE INTO users (username, hashed_password, salt) VALUES (?, ?, ?)', [
        DEFAULT_USERNAME,
        crypto.pbkdf2Sync(DEFAULT_PASSWORD, salt, 310000, 32, 'sha256'),
        salt
      ]);
    }
  });
});

module.exports = db;
