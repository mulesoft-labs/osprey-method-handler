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

var ajv = Ajv({ allErrors: true, verbose: true, jsonPointers: true, errorDataPath: 'property' })

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
  DEFAULT_REQUEST_HEADER_PARAMS[header] = {
    type: 'string',
    required: false
  }
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

  // Headers *always* have a default handler.
  middleware.push(headerHandler(schema.headers, path, method, options))

  if (schema.body) {
    middleware.push(bodyHandler(schema.body, path, method, options))
  } else {
    if (options.discardUnknownBodies !== false) {
      debug(
        '%s %s: Discarding body request stream: ' +
        'Use "*/*" or set "body" to accept content types',
        method,
        path
      )

      middleware.push(discardBody)
    }
  }

  if (schema.responses) {
    middleware.push(acceptsHandler(schema.responses, path, method, options))
  }

  if (schema.queryParameters) {
    middleware.push(queryHandler(schema.queryParameters, path, method, options))
  } else {
    if (options.discardUnknownQueryParameters !== false) {
      debug(
        '%s %s: Discarding all query parameters: ' +
        'Define "queryParameters" to receive parameters',
        method,
        path
      )

      middleware.push(ospreyFastQuery)
    }
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

    return []
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
 * @param  {Object}   options
 * @return {Function}
 */
function queryHandler (queryParameters, path, method, options) {
  var sanitize = ramlSanitize(queryParameters)
  var validate = ramlValidate(queryParameters, options.RAMLVersion)

  return function ospreyQuery (req, res, next) {
    var reqUrl = parseurl(req)
    var query = sanitize(parseQuerystring(reqUrl.query))
    var result = validate(query)

    if (!result.valid) {
      return next(createValidationError(formatRamlErrors(result.errors, 'query')))
    }

    var qs = querystring.stringify(query)

    if (options.discardUnknownQueryParameters !== false) {
      req.url = reqUrl.pathname + (qs ? '?' + qs : '')
      req.query = query
    } else {
      req.query = extend(req.query, query)
    }

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

  return querystring.parse(query.replace(/(?:%5B|\[)\d*(?:%5D|])=/ig, '='))
}

/**
 * Create a request header handling middleware.
 *
 * @param  {Object}   headerParameters
 * @param  {String}   path
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function headerHandler (headerParameters, path, method, options) {
  var headers = extend(DEFAULT_REQUEST_HEADER_PARAMS, lowercaseKeys(headerParameters))
  var sanitize = ramlSanitize(headers)
  var validate = ramlValidate(headers, options.RAMLVersion)

  return function ospreyMethodHeader (req, res, next) {
    var headers = sanitize(lowercaseKeys(req.headers))
    var result = validate(headers)

    if (!result.valid) {
      return next(createValidationError(formatRamlErrors(result.errors, 'header')))
    }

    // Unsets invalid headers. Does not touch `rawHeaders`.
    req.headers = options.discardUnknownHeaders === false ? extend(req.headers, headers) : headers

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
  var bodyMap = {}
  var types = Object.keys(bodies)

  types.forEach(function (type) {
    var handlers = BODY_HANDLERS
      .filter(function (handler) {
        return is.is(handler[0], type)
      })

    // Do not parse on wildcards.
    if (handlers.length > 1 && !options.parseBodiesOnWildcard) {
      return
    }

    // Attach existing handlers.
    handlers.forEach(function (handler) {
      var properType = handler[0]
      var fn = handler[1]

      bodyMap[properType] = fn(bodies[type], path, method, options)
    })
  })

  var validTypes = types.map(JSON.stringify).join(', ')
  var expectedMessage = types.length === 1 ? validTypes : 'one of ' + validTypes

  return function ospreyContentType (req, res, next) {
    var contentType = req.headers['content-type']

    // Error when no body has been sent.
    if (!is.hasBody(req)) {
      return next(createError(
        415,
        'No body sent with request for ' + req.method + ' ' + req.originalUrl +
        ' with content-type "' + contentType + '"'
      ))
    }

    var type = is.is(contentType, types)

    if (!type) {
      return next(createError(
        415,
        'Unsupported content-type header "' + contentType + '", expected ' + expectedMessage
      ))
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
  var jsonBodyParser = require('body-parser').json({
    type: [],
    strict: false,
    limit: options.limit,
    reviver: options.reviver
  })
  var middleware = [jsonBodyParser]
  var schema = body && (body.properties || body.type) || undefined
  var isRAMLType = schema ? schema.constructor === {}.constructor : false

  // This is most likely a JSON schema
  if (!schema) {
    schema = body.schema
  // otherwise, it's an inline type
  } else if (!isRAMLType) {
    schema = body
    isRAMLType = true
  } else if (isRAMLType && Object.keys(schema).length === 0) {
    schema = body
  }

  if (schema) {
    middleware.push(jsonBodyValidationHandler(schema, path, method, options))
  }

  if (!isRAMLType) {
    return compose(middleware)
  }

  // Validate RAML 1.0 min/maxProperties and additionalProperties
  var minProperties = body.minProperties
  var maxProperties = body.maxProperties
  var additionalProperties = body.additionalProperties !== false

  if (minProperties > 0) {
    middleware.push(function (req, res, next) {
      if (Object.keys(req.body).length < minProperties) {
        return next(createValidationError(formatRamlErrors([{
          rule: 'minProperties',
          attr: minProperties
        }], 'json')))
      }

      return next()
    })
  }

  if (maxProperties > 0) {
    middleware.push(function (req, res, next) {
      if (Object.keys(req.body).length > maxProperties) {
        return next(createValidationError(formatRamlErrors([{
          rule: 'maxProperties',
          attr: maxProperties
        }], 'json')))
      }

      return next()
    })
  }

  if (!additionalProperties) {
    middleware.push(function (req, res, next) {
      var additionalPropertyFound = Object.keys(req.body).some(function (key) {
        return !schema.hasOwnProperty(key)
      })
      if (additionalPropertyFound) {
        return next(createValidationError(formatRamlErrors([{
          rule: 'additionalProperties',
          attr: additionalProperties
        }], 'json')))
      }

      return next()
    })
  }

  return compose(middleware)
}

/**
 * Validate JSON bodies.
 *
 * @param  {Object|String}  schema
 * @param  {String}         path
 * @param  {String}         method
 * @return {Function}
 */
function jsonBodyValidationHandler (schema, path, method, options) {
  var jsonSchemaCompatibility = require('json-schema-compatibility')
  var isRAMLType = schema.constructor === {}.constructor
  var validate

  // RAML data types
  if (isRAMLType) {
    validate = ramlValidate(schema, options.RAMLVersion)

  // JSON schema
  } else {
    try {
      schema = JSON.parse(schema)

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
  }

  return function ospreyJsonBody (req, res, next) {
    var result = validate(req.body)

    // RAML data types
    if (isRAMLType) {
      if (!result.valid) {
        return next(createValidationError(formatRamlErrors(result.errors, 'json')))
      }

    // JSON schema
    } else {
      if (!result) {
        return next(createValidationError(formatJsonErrors(validate.errors)))
      }
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
  var urlencodedBodyParser = require('body-parser').urlencoded({
    type: [],
    extended: false,
    limit: options.limit,
    parameterLimit: options.parameterLimit
  })

  var middleware = [urlencodedBodyParser]
  var params = body && (body.formParameters || body.properties) || undefined

  if (params) {
    middleware.push(urlencodedBodyValidationHandler(params, options))
  }

  return compose(middleware)
}

/**
 * Validate url encoded form bodies.
 *
 * @param  {String} parameters
 * @return {String}
 */
function urlencodedBodyValidationHandler (parameters, options) {
  var sanitize = ramlSanitize(parameters)
  var validate = ramlValidate(parameters, options.RAMLVersion)

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
  var xmlParser = xmlBodyParser(options)
  var middleware = [xmlParser]

  if (body && body.schema) {
    middleware.push(xmlBodyValidationHandler(body.schema, path, method))
  }

  return compose(middleware)
}

/**
 * Parse an XML body request.
 *
 * @param  {Object}   options
 * @return {Function}
 */
function xmlBodyParser (options) {
  var libxml = getLibXml()
  var bodyParser = require('body-parser').text({ type: [], limit: options.limit })

  // Parse the request body text.
  function xmlParser (req, res, next) {
    var xml

    try {
      xml = libxml.parseXml(req.body)
    } catch (err) {
      // Add a status code to indicate bad requests automatically.
      err.status = err.statusCode = 400
      return next(err)
    }

    // Assign parsed XML document to the body.
    req.xml = xml

    return next()
  }

  return compose([bodyParser, xmlParser])
}

/**
 * Require `libxmljs` with error messaging.
 *
 * @return {Object}
 */
function getLibXml () {
  var libxml

  try {
    libxml = require('libxmljs')
  } catch (err) {
    err.message = 'Install "libxmljs" using `npm install libxmljs --save` for XML validation'
    throw err
  }

  return libxml
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
  var libxml = getLibXml()
  var schema

  try {
    schema = libxml.parseXml(str)
  } catch (err) {
    err.message = 'Unable to compile XML schema for ' + method + ' ' + path + ': ' + err.message
    throw err
  }

  return function ospreyXmlBody (req, res, next) {
    if (!req.xml.validate(schema)) {
      return next(createValidationError(formatXmlErrors(req.xml.validationErrors)))
    }

    return next()
  }
}

/**
 * Handle and validate form data requests.
 *
 * @param  {Object}   body
 * @param  {String}   path
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function formDataBodyHandler (body, path, method, options) {
  var Busboy = require('busboy')
  var params = body && (body.formParameters || body.properties) || {}
  var validators = {}
  var sanitizers = {}

  // Asynchonously sanitizes and validates values.
  Object.keys(params).forEach(function (key) {
    var param = extend(params[key], { repeat: false })

    sanitizers[key] = ramlSanitize.rule(param)
    validators[key] = ramlValidate.rule(param)
  })

  return function ospreyMethodForm (req, res, next) {
    var received = {}
    var errored = false
    var busboy = req.form = new Busboy({ headers: req.headers, limits: options.busboyLimits })
    var errors = {}

    // Override `emit` to provide validations. Only validate when
    // `formParameters` (or RAML 1.0 `properties`) are set.
    if (body && (body.formParameters || body.properties)) {
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

  // TODO(blakeembrey): Make sure this doesn't break in future node versions.
  if (req._readableState.ended) {
    return next()
  }

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
