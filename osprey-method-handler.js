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
var debug = require('debug')('osprey-method-handler')

var ajv = Ajv({ allErrors: true, verbose: true, jsonPointers: true })

/**
 * Detect JSON schema v3.
 *
 * @type {RegExp}
 */
var JSON_SCHEMA_03 = /^http:\/\/json-schema\.org\/draft-03\/(?:hyper-)?schema/i

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
module.exports.addJsonSchema = addJsonSchema

/**
 * Expose a method to add JSON schemas before compilation.
 *
 * @param {Object} schema
 * @param {String} key
 */
function addJsonSchema (schema, key) {
  ajv.addSchema(schema, key)
}

/**
 * Create a middleware request/response handler.
 *
 * @param  {Object}   schema
 * @param  {String}   path
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function ospreyMethodHandler (schema, path, method, options) {
  schema = schema || {}
  options = options || {}

  var middleware = []

  // Attach the resource path to every validation handler.
  middleware.push(function (req, res, next) {
    req.resourcePath = path

    return next()
  })

  var accepts = acceptsHandler(schema.responses, path, method, options)
  var body = bodyHandler(schema.body, path, method, options)
  var header = headerHandler(schema.headers, path, method, options)
  var query = queryHandler(schema.queryParameters, path, method, options)

  if (accepts) {
    middleware.push(accepts)
  }

  if (body) {
    middleware.push(body)
  }

  if (header) {
    middleware.push(header)
  }

  if (query) {
    middleware.push(query)
  }

  return compose(middleware)
}

/**
 * Create a HTTP accepts handler.
 *
 * @param  {Object}   responses
 * @param  {String}   path
 * @param  {String}   method
 * @return {Function}
 */
function acceptsHandler (responses, path, method) {
  var accepts = {}

  // Collect all valid response types.
  Object.keys(responses || {})
    .filter(function (code) {
      return code >= 200 && code < 300
    })
    .forEach(function (code) {
      var response = responses[code]
      var body = response && response.body || {}

      Object.keys(body).forEach(function (type) {
        accepts[type] = true
      })
    })

  var mediaTypes = Object.keys(accepts)

  // The user will accept anything when there are no types defined.
  if (!mediaTypes.length) {
    debug('%s %s: No accepts media types defined', method, path)

    return
  }

  var validTypes = mediaTypes.map(JSON.stringify).join(', ')
  var expectedMessage = mediaTypes.length === 1 ? validTypes : 'one of ' + validTypes

  return function ospreyAccepts (req, res, next) {
    var negotiator = new Negotiator(req)

    if (!negotiator.mediaType(mediaTypes)) {
      return next(createError(
        406, 'Unsupported accept header "' + req.headers.accept + '", expected ' + expectedMessage
      ))
    }

    return next()
  }
}

/**
 * Create query string handling middleware.
 *
 * @param  {Object}   queryParameters
 * @param  {String}   path
 * @param  {String}   method
 * @return {Function}
 */
function queryHandler (queryParameters, path, method) {
  // Fast query parameters.
  if (!queryParameters) {
    debug(
      '%s %s: Discarding all query parameters: ' +
      'Define "queryParameters" to receive parameters',
      method,
      path
    )

    return ospreyFastQuery
  }

  var sanitize = ramlSanitize(queryParameters)
  var validate = ramlValidate(queryParameters)

  return function ospreyQuery (req, res, next) {
    var reqUrl = parseurl(req)
    var query = sanitize(parseQuerystring(reqUrl.query))
    var result = validate(query)

    if (!result.valid) {
      return next(createValidationError(formatRamlErrors(result.errors, 'query')))
    }

    var qs = querystring.stringify(query)

    req.url = reqUrl.pathname + (qs ? '?' + qs : '')
    req.query = query

    return next()
  }
}

/**
 * Parse query strings with support for array syntax (E.g. `a[]=1&a[]=2`).
 */
function parseQuerystring (query) {
  if (query == null) {
    return {}
  }

  return querystring.parse(query.replace(/(?:%5B|\[)\d*(?:%5D|\])\=/ig, '='))
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
      return next(createValidationError(formatRamlErrors(result.errors, 'header')))
    }

    // Unsets invalid headers. Does not touch `rawHeaders`.
    req.headers = headers

    return next()
  }
}

/**
 * Handle incoming request bodies.
 *
 * @param  {Object}   bodies
 * @param  {String}   path
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function bodyHandler (bodies, path, method, options) {
  if (!bodies) {
    debug(
      '%s %s: Discarding body request stream: ' +
      'Use "*/*" or set "body" to accept content types',
      method,
      path
    )

    return options.discardUnknownBodies === false ? undefined : discardBody
  }

  var bodyMap = {}
  var types = Object.keys(bodies)

  BODY_HANDLERS.forEach(function (handler) {
    var type = handler[0]
    var fn = handler[1]
    var result = is.is(type, types)

    if (result) {
      bodyMap[result] = fn(bodies[result], path, method, options)
    }
  })

  var validTypes = types.map(JSON.stringify).join(', ')
  var expectedMessage = types.length === 1 ? validTypes : 'one of ' + validTypes

  return function ospreyContentType (req, res, next) {
    var type = is(req, types)

    if (!type) {
      return next(createError(415, 'Unsupported content-type header "' + req.headers['content-type'] + '", expected ' + expectedMessage))
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
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function jsonBodyHandler (body, path, method, options) {
  if (!body || !body.schema) {
    debug(
      '%s %s: Body JSON schema missing: ' +
      'Define "schema" to parse and receive JSON',
      method,
      path
    )

    return
  }

  var jsonBodyParser = require('body-parser').json({
    type: [],
    strict: false,
    limit: options.limit,
    reviver: options.reviver
  })

  return compose([
    jsonBodyParser,
    jsonBodyValidationHandler(body.schema, path, method)
  ])
}

/**
 * Validate JSON bodies.
 *
 * @param  {String}   str
 * @param  {String}   path
 * @param  {String}   method
 * @return {Function}
 */
function jsonBodyValidationHandler (str, path, method) {
  var jsonSchemaCompatibility = require('json-schema-compatibility')
  var schema
  var validate

  try {
    schema = JSON.parse(str)

    // Convert draft-03 schema to 04.
    if (JSON_SCHEMA_03.test(schema.$schema)) {
      schema = jsonSchemaCompatibility.v4(schema)
      schema.$schema = 'http://json-schema.org/draft-04/schema'
    }

    validate = ajv.compile(schema)
  } catch (err) {
    err.message = 'Unable to compile JSON schema for ' + method + ' ' + path + ': ' + err.message
    throw err
  }

  return function ospreyJsonBody (req, res, next) {
    var valid = validate(req.body)

    if (!valid) {
      return next(createValidationError(formatJsonErrors(validate.errors)))
    }

    return next()
  }
}

/**
 * Handle url encoded form requests.
 *
 * @param  {Object}   body
 * @param  {String}   path
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function urlencodedBodyHandler (body, path, method, options) {
  if (!body || !body.formParameters) {
    debug(
      '%s %s: Body URL Encoded form parameters missing: ' +
      'Define "formParameters" to parse and receive body parameters',
      method,
      path
    )

    return
  }

  var urlencodedBodyParser = require('body-parser').urlencoded({
    type: [],
    extended: false,
    limit: options.limit,
    parameterLimit: options.parameterLimit
  })

  return compose([
    urlencodedBodyParser,
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
      return next(createValidationError(formatRamlErrors(result.errors, 'form')))
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
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function xmlBodyHandler (body, path, method, options) {
  if (!body || !body.schema) {
    debug(
      '%s %s: Body XML schema missing: ' +
      'Define "schema" to parse and receive XML content',
      method,
      path
    )

    return
  }

  return compose([
    require('body-parser').text({ type: [], limit: options.limit }),
    xmlBodyValidationHandler(body.schema, path, method)
  ])
}

/**
 * Validate XML request bodies.
 *
 * @param  {String}   str
 * @param  {String}   path
 * @param  {String}   method
 * @return {Function}
 */
function xmlBodyValidationHandler (str, path, method) {
  var schema
  var libxml

  try {
    libxml = require('libxmljs')
  } catch (err) {
    err.message = 'Install "libxmljs" using `npm install libxmljs --save` for XML validation'
    throw err
  }

  try {
    schema = libxml.parseXml(str)
  } catch (err) {
    err.message = 'Unable to compile XML schema for ' + method + ' ' + path + ': ' + err.message
    throw err
  }

  return function ospreyXmlBody (req, res, next) {
    var doc

    try {
      doc = libxml.parseXml(req.body)
    } catch (err) {
      // Add a status code to indicate bad requests automatically.
      err.status = err.statusCode = 400
      return next(err)
    }

    if (!doc.validate(schema)) {
      return next(createValidationError(formatXmlErrors(doc.validationErrors)))
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
 * @param  {String}   method
 * @return {Function}
 */
function formDataBodyHandler (body, path, method) {
  if (!body || !body.formParameters) {
    debug(
      '%s %s: Body multipart form parameters missing: ' +
      'Define "formParameters" to parse and receive form content',
      method,
      path
    )

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
            key: name,
            attr: false
          }

          errored = true

          return close()
        }

        // Set the value to be already received.
        received[name] = true

        // Check the value is valid.
        var result = validators[name](value, name)

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
              key: key,
              attr: true
            }
          })
          .concat(values(errors))

        if (validationErrors.length) {
          Busboy.prototype.emit.call(
            this,
            'error',
            createValidationError(formatRamlErrors(validationErrors, 'form'))
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
function createValidationError (errors) {
  var self = createError(400, 'Request failed to validate against RAML definition')

  self.requestErrors = errors
  self.ramlValidation = true

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
  debug('%s %s: Discarding request stream', req.method, req.url)

  req.resume()
  req.on('end', next)
  req.on('error', next)
}

/**
 * Enable fast query parameters (E.g. discard them all).
 *
 * @param {Object}   req
 * @param {Object}   res
 * @param {Function} next
 */
function ospreyFastQuery (req, res, next) {
  req.url = parseurl(req).pathname
  req.query = {}

  return next()
}

/**
 * Noop.
 */
function noop () {}

/**
 * Make RAML validation errors match standard format.
 *
 * @param  {Array} errors
 * @return {Array}
 */
function formatRamlErrors (errors, type) {
  return errors.map(function (error) {
    return {
      type: type,
      dataPath: error.key,
      keyword: error.rule,
      schema: error.attr,
      data: error.value,
      message: 'invalid ' + type + ' (' + error.rule + ', ' + error.attr + ')'
    }
  })
}

/**
 * Make JSON validation errors match standard format.
 *
 * @param  {Array} errors
 * @return {Array}
 */
function formatJsonErrors (errors) {
  return errors.map(function (error) {
    return {
      type: 'json',
      keyword: error.keyword,
      dataPath: error.dataPath,
      message: error.message,
      data: error.data,
      schema: error.schema
    }
  })
}

/**
 * Make XML validation errors match standard format.
 *
 * @param  {Array} errors
 * @return {Array}
 */
function formatXmlErrors (errors) {
  return errors.map(function (error) {
    return {
      type: 'xml',
      message: error.message,
      meta: {
        domain: error.domain,
        code: error.code,
        level: error.level,
        column: error.column,
        line: error.line
      }
    }
  })
}
