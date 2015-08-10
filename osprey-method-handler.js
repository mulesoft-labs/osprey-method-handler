var is = require('type-is')
var extend = require('xtend')
var parseurl = require('parseurl')
var querystring = require('querystring')
var createError = require('http-errors')
var lowercaseKeys = require('lowercase-keys')
var ramlSanitize = require('raml-sanitize')()
var ramlValidate = require('raml-validate')()
var isStream = require('is-stream')
var values = require('object-values')
var Negotiator = require('negotiator')
var standardHeaders = require('standard-headers')
var compose = require('compose-middleware').compose
var Ajv = require('ajv')

var ajv = Ajv({ allErrors: true })

/**
 * Get all default headers.
 *
 * @type {Object}
 */
var DEFAULT_REQUEST_HEADER_PARAMS = {}

// Fill header params with non-required parameters.
standardHeaders.request.forEach(function (header) {
  DEFAULT_REQUEST_HEADER_PARAMS[header] = { type: 'string' }
})

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
]

/**
 * Set custom file validation.
 *
 * @param  {Stream}  value
 * @return {Boolean}
 */
ramlValidate.TYPES.file = function (stream) {
  return isStream(stream)
}

/**
 * Export `ospreyMethodHandler`.
 */
module.exports = ospreyMethodHandler

/**
 * Create a middleware request/response handler.
 *
 * @param  {Object}   schema
 * @param  {String}   path
 * @return {Function}
 */
function ospreyMethodHandler (schema, path) {
  schema = schema || {}

  var middleware = []

  // Attach the resource path to every validation handler.
  middleware.push(function (req, res, next) {
    req.resourcePath = path

    return next()
  })

  middleware.push(acceptsHandler(schema.responses, path))
  middleware.push(bodyHandler(schema.body, path))
  middleware.push(headerHandler(schema.headers, path))
  middleware.push(queryHandler(schema.queryParameters, path))

  return compose(middleware)
}

/**
 * Create a HTTP accepts handler.
 *
 * @param  {Object}   responses
 * @return {Function}
 */
function acceptsHandler (responses) {
  var accepts = {}

  // Collect all valid response types.
  Object.keys(responses || {}).forEach(function (code) {
    if (isNaN(code) || code > 300) {
      return
    }

    var response = responses[code]
    var body = response && response.body

    if (!body) {
      return
    }

    Object.keys(body).forEach(function (type) {
      accepts[type] = true
    })
  })

  var mediaTypes = Object.keys(accepts)

  // The user can accept anything when there are no types. We will be more
  // strict when the user tries to respond with a body.
  if (!mediaTypes.length) {
    return
  }

  return function ospreyAccepts (req, res, next) {
    var negotiator = new Negotiator(req)

    if (!negotiator.mediaType(mediaTypes)) {
      return next(createError(
        406, 'Accepted types are ' + mediaTypes.map(JSON.stringify).join(', ')
      ))
    }

    return next()
  }
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
    return function ospreyQueryFast (req, res, next) {
      req.url = parseurl(req).pathname
      req.query = {}

      return next()
    }
  }

  var sanitize = ramlSanitize(queryParameters)
  var validate = ramlValidate(queryParameters)

  return function ospreyQuery (req, res, next) {
    var reqUrl = parseurl(req)
    var query = sanitize(querystring.parse(reqUrl.query))
    var result = validate(query)

    if (!result.valid) {
      return next(createValidationError('query', result.errors))
    }

    var qs = querystring.stringify(query)

    req.url = reqUrl.pathname + (qs ? '?' + qs : '')
    req.query = query

    return next()
  }
}

/**
 * Create a request header handling middleware.
 *
 * @param  {Object}   headerParameters
 * @return {Function}
 */
function headerHandler (headerParameters) {
  var headers = extend(DEFAULT_REQUEST_HEADER_PARAMS, lowercaseKeys(headerParameters))

  var sanitize = ramlSanitize(headers)
  var validate = ramlValidate(headers)

  return function ospreyMethodHeader (req, res, next) {
    var headers = sanitize(lowercaseKeys(req.headers))
    var result = validate(headers)

    if (!result.valid) {
      return next(createValidationError('headers', result.errors))
    }

    // Unsets invalid headers.
    req.headers = headers

    return next()
  }
}

/**
 * Handle incoming request bodies.
 *
 * @param  {Object}   bodies
 * @param  {String}   path
 * @return {Function}
 */
function bodyHandler (bodies, path) {
  if (!bodies) {
    return discardBody
  }

  var bodyMap = {}
  var types = Object.keys(bodies)

  BODY_HANDLERS.forEach(function (handler) {
    var type = handler[0]
    var fn = handler[1]
    var result = is.is(type, types)

    if (result) {
      bodyMap[result] = fn(bodies[result], path)
    }
  })

  var validTypes = types.map(JSON.stringify).join(', ')

  return function ospreyContentType (req, res, next) {
    var type = is(req, types)

    if (!type) {
      return next(createError(415, 'Supported content types are ' + validTypes))
    }

    var fn = bodyMap[type]

    return fn ? fn(req, res, next) : next()
  }
}

/**
 * Handle JSON requests.
 *
 * @param  {Object}   body
 * @param  {String}   path
 * @return {Function}
 */
function jsonBodyHandler (body, path) {
  if (!body || !body.schema) {
    console.warn('JSON body schema missing for "' + path + '"')

    return
  }

  return compose([
    require('body-parser').json({ type: [] }),
    jsonBodyValidationHandler(body.schema, path)
  ])
}

/**
 * Validate JSON bodies.
 *
 * @param  {String}   str
 * @param  {String}   path
 * @return {Function}
 */
function jsonBodyValidationHandler (str, path) {
  var jsonSchemaCompatibility = require('json-schema-compatibility')
  var validate

  try {
    validate = ajv.compile(jsonSchemaCompatibility.v4(JSON.parse(str)))
  } catch (err) {
    err.message = 'Unable to compile JSON schema for "' + path + '": ' + err.message
    throw err
  }

  return function ospreyJsonBody (req, res, next) {
    var valid = validate(req.body)

    if (!valid) {
      return next(createValidationError('json', validate.errors))
    }

    return next()
  }
}

/**
 * Handle url encoded form requests.
 *
 * @param  {Object}   body
 * @return {Function}
 */
function urlencodedBodyHandler (body, path) {
  if (!body || !body.formParameters) {
    console.warn('Encoded form parameters missing for "' + path + '"')

    return
  }

  return compose([
    require('body-parser').urlencoded({ type: [], extended: false }),
    urlencodedBodyValidationHandler(body.formParameters)
  ])
}

/**
 * Validate url encoded form bodies.
 *
 * @param  {String} parameters
 * @return {String}
 */
function urlencodedBodyValidationHandler (parameters) {
  var sanitize = ramlSanitize(parameters)
  var validate = ramlValidate(parameters)

  return function ospreyUrlencodedBody (req, res, next) {
    var body = sanitize(req.body)
    var result = validate(body)

    if (!result.valid) {
      return next(createValidationError('form', result.errors))
    }

    // Discards invalid url encoded parameters.
    req.body = body

    return next()
  }
}

/**
 * Handle XML requests.
 *
 * @param  {Object}   body
 * @param  {String}   path
 * @return {Function}
 */
function xmlBodyHandler (body, path) {
  if (!body || !body.schema) {
    console.warn('XML schema missing for "' + path + '"')

    return
  }

  return compose([
    require('body-parser').text({ type: [] }),
    xmlBodyValidationHandler(body.schema, path)
  ])
}

/**
 * Validate XML request bodies.
 *
 * @param  {String}   str
 * @param  {String}   path
 * @return {Function}
 */
function xmlBodyValidationHandler (str, path) {
  var schema
  var libxml

  try {
    libxml = require('libxmljs')
  } catch (err) {
    err.message = 'Install "libxmljs" using `npm install libxmljs --save` for XML validation to work'
    throw err
  }

  try {
    schema = libxml.parseXml(str)
  } catch (err) {
    err.message = 'Unable to compile XML schema for "' + path + '": ' + err.message
    throw err
  }

  return function ospreyXmlBody (req, res, next) {
    var doc

    try {
      doc = libxml.parseXml(req.body)
    } catch (e) {
      return next(createError(400, e.message))
    }

    if (!doc.validate(schema)) {
      return next(createValidationError('xml', doc.validationErrors))
    }

    // Assign parsed XML document to the body.
    req.xml = doc

    return next()
  }
}

/**
 * Handle and validate form data requests.
 *
 * @param  {Object}   body
 * @param  {String}   path
 * @return {Function}
 */
function formDataBodyHandler (body, path) {
  if (!body || !body.formParameters) {
    console.warn('Multipart form parameters missing for "' + path + '"')

    return
  }

  var Busboy = require('busboy')
  var params = body.formParameters
  var validators = {}
  var sanitizers = {}

  // Asynchonously sanitizes and validates values.
  Object.keys(params).forEach(function (key) {
    var param = extend(params[key])

    // Remove repeated validation and sanitization for async handling.
    delete param.repeat

    sanitizers[key] = ramlSanitize.rule(param)
    validators[key] = ramlValidate.rule(param)
  })

  return function ospreyMethodForm (req, res, next) {
    var received = {}
    var errored = false
    var busboy = req.form = new Busboy({ headers: req.headers })
    var errors = {}

    // Override `emit` to provide validations.
    busboy.emit = function emit (type, name, value, a, b, c) {
      var close = type === 'field' ? noop : function () {
        value.resume()
      }

      if (type === 'field' || type === 'file') {
        if (!params.hasOwnProperty(name)) {
          return close()
        }

        // Sanitize the value before emitting.
        value = sanitizers[name](value)

        // Check for repeat errors.
        if (received[name] && !params[name].repeat) {
          errors[name] = {
            valid: false,
            rule: 'repeat',
            value: value,
            key: name
          }

          errored = true

          return close()
        }

        // Set the value to be already received.
        received[name] = true

        // Check the value is valid.
        var result = validators[name](value)

        // Collect invalid values.
        if (!result.valid) {
          errored = true
          errors[name] = result
        }

        // Don't emit when an error has already occured. Check after the
        // value validation because we want to collect all possible errors.
        if (errored) {
          return close()
        }
      } else if (type === 'finish') {
        // Finish emits twice, but is actually done the second time.
        if (!this._done) {
          return Busboy.prototype.emit.call(this, 'finish')
        }

        var validationErrors = Object.keys(params)
          .filter(function (key) {
            return params[key].required && !received[key]
          })
          .map(function (key) {
            return {
              valid: false,
              rule: 'required',
              value: undefined,
              key: key
            }
          })
          .concat(values(errors))

        if (validationErrors.length) {
          Busboy.prototype.emit.call(
            this,
            'error',
            createValidationError('form', validationErrors)
          )

          return
        }
      }

      return Busboy.prototype.emit.apply(this, arguments)
    }

    return next()
  }
}

/**
 * Create a validation error.
 *
 * @param  {String} type
 * @param  {Array}  errors
 * @return {Error}
 */
function createValidationError (type, errors) {
  var self = createError(400, 'Invalid ' + type)

  self.ramlValidation = self.validationType = type
  self.validationErrors = errors

  return self
}

/**
 * Discard the request body.
 *
 * @param {Object}   req
 * @param {Object}   res
 * @param {Function} next
 */
function discardBody (req, res, next) {
  req.resume()
  req.on('end', next)
  req.on('error', next)
}

/**
 * Noop.
 */
function noop () {}
