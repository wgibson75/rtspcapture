const express = require('express');

const logger = require('../logger');

////////////////////
////// Router //////
////////////////////

const router = express.Router();

router.get(/^.*$/, function(request, response, next) {
    logger.info('%s %s', request.method, request.url);
    next(); // Call the next matching handler
});

module.exports = router;