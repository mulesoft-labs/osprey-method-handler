var is = require('type-is');
var router = require('osprey-router');
var extend = require('xtend');
var parseurl = require('parseurl');
var querystring = require('querystring');
var createError = require('http-errors');
var lowercaseKeys = require('lowercase-keys');
var ramlSanitize = require('raml-sanitize')();
var ramlValidate = require('raml-validate')();
var isStream = require('is-stream');

/**
 * Get all default headers.
 *
 * @type {Object}
 */
var DEFAULT_HEADER_PARAMS = {};

// Fill header params with non-required parameters.
require('standard-headers').forEach(function (header) {
  DEFAULT_HEADER_PARAMS[header] = { type: 'string' };
});

/**
 * Application body parsers and validators.
 *
 * @type {Array}
 */
var BODY_HANDLERS = [
  ['application/json', jsonBodyHandler],
  ['text/xml', xmlBodyHandler],
  ['application/x-www-form-urlencoded', urlencodedBodyHandler],
  ['multipart/form-data', formDataBodyHandler]
];

/**
 * Set custom file validation.
 *
 * @param  {Stream}  value
 * @return {Boolean}
 */
ramlValidate.TYPES.file = function (stream) {
  return isStream(stream);
};

/**
 * Export `ospreyMethodHandler`.
 */
module.exports = ospreyMethodHandler;

/**
 * Create a middleware request/response handler.
 *
 * @param  {Object}   schema
 * @param  {Object}   options
 * @return {Function}
 */
function ospreyMethodHandler (schema) {
  schema = schema || {};

  var app = router();

  app.use(headerHandler(schema.headers));
  app.use(queryHandler(schema.queryParameters));

  // TODO: When no body, discard contents.
  if (schema.body) {
    app.use(bodyHandler(schema.body));
  }

  return app;
}

/**
 * Create query string handling middleware.
 *
 * @param  {Object}   queryParameters
 * @return {Function}
 */
function queryHandler (queryParameters) {
  // Fast query parameters.
  if (!queryParameters) {
    return function ospreyMethodQueryFast (req, res, next) {
      req.url = parseurl(req).pathname;
      req.query = {};

      return next();
    };
  }

  var sanitize = ramlSanitize(queryParameters);
  var validate = ramlValidate(queryParameters);

  return function ospreyMethodQuery (req, res, next) {
    var reqUrl = parseurl(req);
    var query = sanitize(querystring.parse(reqUrl.query));
    var result = validate(query);

    if (!result.valid) {
      return next(createError(400, 'Invalid query parameters'));
    }

    var qs = querystring.stringify(query);

    req.url = reqUrl.pathname + (qs ? '?' + qs : '');
    req.query = query;

    return next();
  };
}

/**
 * Create a request header handling middleware.
 *
 * @param  {Object}   headerParameters
 * @return {Function}
 */
function headerHandler (headerParameters) {
  var headers = extend(DEFAULT_HEADER_PARAMS, lowercaseKeys(headerParameters));

  var sanitize = ramlSanitize(headers);
  var validate = ramlValidate(headers);

  return function ospreyMethodHeader (req, res, next) {
    var headers = sanitize(lowercaseKeys(req.headers));
    var result = validate(headers);

    if (!result.valid) {
      return next(createError(400, 'Invalid headers'));
    }

    // Unsets invalid headers.
    req.headers = headers;

    return next();
  };
}

/**
 * Handle incoming request bodies.
 *
 * @param  {Object}   bodies
 * @return {Function}
 */
function bodyHandler (bodies) {
  var map = {};
  var types = Object.keys(bodies);

  BODY_HANDLERS.forEach(function (handler) {
    var type = handler[0];
    var fn = handler[1];
    var result = is.is(type, types);

    if (!result) {
      return;
    }

    map[result] = fn(bodies[result]);
  });

  return createTypeMiddleware(map);
}

/**
 * Handle JSON requests.
 *
 * @param  {Object}   body
 * @return {Function}
 */
function jsonBodyHandler (body) {
  if (!body || !body.schema) {
    throw new TypeError('missing json schema');
  }

  var app = router();

  app.use(require('body-parser').json({ type: [] }));
  app.use(jsonBodyValidationHandler(body.schema));

  return app;
}

/**
 * Validate bodies as JSON.
 *
 * @param  {String}   str
 * @return {Function}
 */
function jsonBodyValidationHandler (str) {
  var tv4 = require('tv4');
  var schema = JSON.parse(str);

  return function ospreyMethodJson (req, res, next) {
    var result = tv4.validateResult(req.body, schema, true, true);

    if (!result.valid) {
      return next(createError(400, 'Invalid JSON'));
    }

    return next();
  };
}

/**
 * Handle url encoded form requests.
 *
 * @param  {Object}   body
 * @return {Function}
 */
function urlencodedBodyHandler (body) {
  if (!body || !body.formParameters) {
    throw new TypeError('missing url encoded form parameters');
  }

  var app = router();

  app.use(require('body-parser').urlencoded({ type: [], extended: false }));
  app.use(urlencodedBodyValidationHandler(body.formParameters));

  return app;
}

/**
 * Validate url encoded form bodies.
 *
 * @param  {String} parameters
 * @return {String}
 */
function urlencodedBodyValidationHandler (parameters) {
  var sanitize = ramlSanitize(parameters);
  var validate = ramlValidate(parameters);

  return function ospreyMethodUrlencoded (req, res, next) {
    var body = sanitize(req.body);
    var result = validate(body);

    if (!result.valid) {
      return next(createError(400, 'Invalid form body'));
    }

    // Discards invalid url encoded parameters.
    req.body = body;

    return next();
  };
}

/**
 * Handle XML requests.
 *
 * @param  {Object}   body
 * @return {Function}
 */
function xmlBodyHandler (body) {
  if (!body || !body.schema) {
    throw new TypeError('missing xml schema');
  }

  var app = router();

  app.use(require('body-parser').text({ type: [] }));
  app.use(xmlBodyValidationHandler(body.schema));

  return app;
}

/**
 * Validate XML request bodies.
 *
 * @param  {String}   str
 * @return {Function}
 */
function xmlBodyValidationHandler (str) {
  var libxml = require('libxmljs');
  var xsdDoc = libxml.parseXml(str);

  return function ospreyMethodXml (req, res, next) {
    var xmlDoc = libxml.parseXml(req.body);

    if (!xmlDoc.validate(xsdDoc)) {
      // xmlDoc.validationErrors
      return next(createError(400, 'Invalid XML'));
    }

    // Assign parsed XML document to the body.
    req.xml = xmlDoc;

    return next();
  };
}

/**
 * Handle form data requests.
 *
 * @param  {Object}   body
 * @return {Function}
 */
function formDataBodyHandler (body) {
  if (!body || !body.formParameters) {
    throw new TypeError('missing form data form parameters');
  }

  var app = router();
  var Busboy = require('busboy');
  var params = body.formParameters;
  var validations = {};
  var sanitizations = {};

  // Manually create validations and sanitizations.
  Object.keys(params).forEach(function (key) {
    var param = extend(params[key]);

    // Needed to handle repeat errors asynchronously.
    delete param.repeat;

    validations[key] = ramlValidate.rule(param);
    sanitizations[key] = ramlSanitize.rule(param);
  });

  app.use(function ospreyMethodForm (req, res, next) {
    var received = {};
    var busboy = req.form = new Busboy({ headers: req.headers });

    // Override `emit` to provide validations.
    busboy.emit = function emit (type, name, field, a, b, c) {
      if (type === 'field' || type === 'file') {
        if (!params.hasOwnProperty(name)) {
          // Throw away invalid file streams.
          if (type === 'file') {
            field.resume();
          }

          return;
        }

        // Handle repeat parameters as errors.
        if (received[name] && !params[name].repeat) {
          busboy.emit('error', createError(400, 'Invalid repeated param'));

          return;
        }

        received[name] = true;

        var value = sanitizations[name](field);
        var result = validations[name](value);

        if (!result.valid) {
          busboy.emit('error', createError(400, 'Invalid form data'));

          return;
        }

        return Busboy.prototype.emit.call(this, type, name, value, a, b, c);
      }

      if (type === 'finish') {
        var missingParams = Object.keys(params).filter(function (key) {
          return params[key].required && !received[key];
        });

        if (missingParams.length) {
          busboy.emit('error', createError(400, 'Invalid number of params'));

          return;
        }
      }

      return Busboy.prototype.emit.apply(this, arguments);
    };

    return next();
  });

  return app;
}

/**
 * Create a middleware function that accepts requests of the type.
 *
 * @param  {Object}   map
 * @return {Function}
 */
function createTypeMiddleware (map) {
  var types = Object.keys(map);

  return function ospreyMethodType (req, res, next) {
    var type = is(req, types);

    if (!type) {
      return next(createError(415, 'Unknown content type'));
    }

    var fn = map[type];

    return fn ? fn(req, res, next) : next();
  };
}
