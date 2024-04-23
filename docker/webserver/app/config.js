const fs   = require('graceful-fs');
const path = require('path');

module.exports = {
    config: null,

    load: function(config_file) {
        // Load the configuration file
        let config = JSON.parse(fs.readFileSync(config_file, 'utf8'));

        config.camera_config = {};
        // Build lookup for camera configuration
        config.cameras.forEach((cam, i) => {
            config.camera_config[cam.name] = cam;
        });

        // Setup snapshot paths
        config.snapshot_path = path.join(config.root_path, config.snapshots_dir);
        config.snapshot_images_path = path.join(config.snapshot_path, config.snapshot_images_dir);

        // Setup configured URL request translations
        config.url_regex_capture   = new RegExp('^\/' + config.capture_dir   + '($|\/)');
        config.url_regex_snapshots = new RegExp('^\/' + config.snapshots_dir + '($|\/)');
        config.url_regex_logs      = new RegExp('^\/' + config.logs_dir      + '($|\/)');

        this.config = config;
    },

    get: function(field_name) {
        return this.config[field_name];
    }
};