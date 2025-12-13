const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { origins } = require('../config/cors');

module.exports = (app) => {
  app.use(helmet());

  if (origins === '*') {
    app.use(cors({ origin: true, credentials: true }));
  } else {
    app.use(cors({ origin: origins, credentials: true }));
  }

  app.use(morgan('dev'));
  app.use(require('express').json({ limit: '2mb' }));
  app.use(require('express').urlencoded({ extended: true }));
};
