const is = require('type-is')
const extend = require('xtend')
const parseurl = require('parseurl')
const querystring = require('querystring')
const createError = require('http-errors')
const lowercaseKeys = require('lowercase-keys')
const ramlSanitize = require('raml-sanitize')()
const ramlValidate = require('raml-validate')()
const isStream = require('is-stream')
const values = require('object-values')
const Negotiator = require('negotiator')
const standardHeaders = require('standard-headers')
const compose = require('compose-middleware').compose
const Ajv = require('ajv')
const debug = require('debug')('osprey-method-handler')
const wp = require('webapi-parser')

const ajv = Ajv({
  schemaId: 'auto',
  allErrors: true,
  verbose: true,
  jsonPointers: true,
  errorDataPath: 'property'
})
ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-04.json'))

/**
 * Detect JSON schema v3.
 *
 * @type {RegExp}
 */
const JSON_SCHEMA_03 = /^http:\/\/json-schema\.org\/draft-03\/(?:hyper-)?schema/i

const DEFAULT_OPTIONS =  {
  discardUnknownBodies: true,
  discardUnknownQueryParameters: true,
  discardUnknownHeaders: true,
  parseBodiesOnWildcard: false,
  limit: '100kb',
  parameterLimit: 1000,
  RAMLVersion: 'RAML08'
}

/**
 * Get all default headers.
 *
 * @type {Object}
 */
const DEFAULT_REQUEST_HEADER_PARAMS = {}

// Fill header params with non-required parameters.
standardHeaders.request.forEach(function (header) {
  DEFAULT_REQUEST_HEADER_PARAMS[header] = new wp.model.domain.Parameter()
    .withName(header)
    .withRequired(false)
    .withSchema(
      new wp.model.domain.ScalarShape()
        .withName('schema')
        .withDataType('http://www.w3.org/2001/XMLSchema#string'))
})

/**
 * Application body parsers and validators.
 *
 * @type {Array}
 */
const BODY_HANDLERS = [
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
function addJsonSchema (schema, key, options) {
  options = options || {}
  if (options.ajv) {
    options.ajv.addSchema(schema, key)
  } else {
    ajv.addSchema(schema, key)
  }
}

/**
 * Create a middleware request/response handler.
 *
 * @param  {webapi-parser.Operation} method
 * @param  {String}   path
 * @param  {Object}   options
 * @return {Function}
 */
function ospreyMethodHandler (method, path, options) {
// function ospreyMethodHandler (schema, path, methodName, options) {
  const methodName = method.method.value()
  options = extend(DEFAULT_OPTIONS, options)

  const middleware = []

  // Attach the resource path to every validation handler.
  middleware.push(function resourcePathAttacher (req, res, next) {
    req.resourcePath = path
    return next()
  })

  // Headers *always* have a default handler.
  middleware.push(headerHandler(method.request.headers, options))

  if (method.request.payloads.length > 0) {
    // 3 DIVED HERE >>v
    middleware.push(bodyHandler(method.request.payloads, path, methodName, options))
  } else {
    if (options.discardUnknownBodies) {
      debug(
        '%s %s: Discarding body request stream: ' +
        'Use "*/*" or set "body" to accept content types',
        methodName,
        path
      )
      middleware.push(discardBody)
    }
  }

  if (method.responses) {
    middleware.push(acceptsHandler(method.responses, path, methodName, options))
  }

  if (method.queryParameters) {
    middleware.push(queryHandler(method.queryParameters, options))
  } else {
    if (options.discardUnknownQueryParameters) {
      debug(
        '%s %s: Discarding all query parameters: ' +
        'Define "queryParameters" to receive parameters',
        methodName,
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
 * @param  {String}   methodName
 * @return {Function}
 */
function acceptsHandler (responses, path, methodName) {
  const accepts = {}

  // Collect all valid response types.
  Object.keys(responses || {})
    .filter(function (code) {
      return code >= 200 && code < 300
    })
    .forEach(function (code) {
      const response = responses[code]
      const body = (response && response.body) || {}

      Object.keys(body).forEach(function (type) {
        accepts[type] = true
      })
    })

  const mediaTypes = Object.keys(accepts)

  // The user will accept anything when there are no types defined.
  if (!mediaTypes.length) {
    debug('%s %s: No accepts media types defined', methodName, path)

    return []
  }

  const validTypes = mediaTypes.map(JSON.stringify).join(', ')
  const expectedMessage = mediaTypes.length === 1 ? validTypes : 'one of ' + validTypes

  return function ospreyAccepts (req, res, next) {
    const negotiator = new Negotiator(req)

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
 * @param  {Object}   options
 * @return {Function}
 */
function queryHandler (queryParameters, options) {
  const sanitize = ramlSanitize(queryParameters)
  const validate = ramlValidate(queryParameters, options.RAMLVersion)

  return function ospreyQuery (req, res, next) {
    const reqUrl = parseurl(req)
    const query = sanitize(parseQuerystring(reqUrl.query))
    const result = validate(query)

    if (!result.valid) {
      return next(createValidationError(formatRamlErrors(result.errors, 'query')))
    }

    const qs = querystring.stringify(query)

    if (options.discardUnknownQueryParameters) {
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
 * @param  {Array<webapi-parser.Parameter>}   headers
 * @param  {Object}   options
 * @return {Function}
 */
function headerHandler (headers = [], options) {
  const schemas = {}
  headers.map(header => {
    header.withName(header.name.value().toLowerCase())
    schemas[header.name.value()] = header
  })
  schemas = extend(DEFAULT_REQUEST_HEADER_PARAMS, schemas)

  // Unsets invalid headers. Does not touch `rawHeaders`.
  if (options.discardUnknownHeaders) {
    const definedHeaders = Object.entries(req.headers)
      .filter(([name, val]) => !!schemas[name])
    req.headers = Object.fromEntries(definedHeaders)
  }

  return async function ospreyMethodHeader (req, res, next) {
    const reports = await Promise.all(
      Object.entries(req.headers || {}).map(([name, value]) => {
        const schema = schemas[name]
        return schema ? schema.validate(value) : Promise.resolve()
      })
    )
    reports.forEach(report => {
      if (!report.conforms) {
        return next(createValidationError(
          formatRamlValidationReport(report, 'header')))
      }
    })
    return next()
  }
}

/**
 * Handle incoming request bodies.
 *
 * @param  {Array<webapi-parser.Payload>} bodies
 * @param  {String}   path
 * @param  {String}   methodName
 * @param  {Object}   options
 * @return {Function}
 */
function bodyHandler (bodies, path, methodName, options) {
  const bodyMap = {}

  bodies.forEach(body => {
    const type = body.mediaType.value()
    const handlers = BODY_HANDLERS.filter(([ct, handler]) => is.is(ct, type))
    // Do not parse on wildcards
    if (handlers.length > 1 && !options.parseBodiesOnWildcard) {
      return
    }

    // Attach existing handlers
    handlers.forEach(([properType, fn]) {
      // 4 DIVED HERE >>v Rework each handler
      bodyMap[properType] = fn(body, path, methodName, options)
    })
  })

  const types = bodies.map(b => body.mediaType.value())
  const validTypes = types.map(JSON.stringify).join(', ')
  const expectedMessage = types.length === 1 ? validTypes : 'one of ' + validTypes

  return function ospreyContentType (req, res, next) {
    const ct = req.headers['content-type']

    // Error when no body has been sent.
    if (!is.hasBody(req)) {
      return next(createError(
        415,
        'No body sent with request for ' + req.method + ' ' + req.originalUrl +
        ' with content-type "' + ct + '"'
      ))
    }

    const type = is.is(ct, types)

    if (!type) {
      return next(createError(
        415,
        'Unsupported content-type header "' + ct + '", expected ' + expectedMessage
      ))
    }

    const fn = bodyMap[type]

    return fn ? fn(req, res, next) : next()
  }
}

/**
 * Handle JSON requests.
 *
 * @param  {webapi-parser.Payload}   body
 * @param  {String}   path
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function jsonBodyHandler (body, path, method, options) {
  const jsonBodyParser = require('body-parser').json({
    type: [],
    strict: false,
    limit: options.limit,
    reviver: options.reviver
  })
  const middleware = [jsonBodyParser]
  let schema = (body && (body.properties || body.type)) || undefined
  let isRAMLType = schema ? schema.constructor === {}.constructor : false

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
  const minProperties = body.minProperties
  const maxProperties = body.maxProperties
  const additionalProperties = body.additionalProperties

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
      const additionalPropertyFound = Object.keys(req.body).some(function (key) {
        return !Object.prototype.hasOwnProperty.call(schema, key)
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
  const jsonSchemaCompatibility = require('json-schema-compatibility')
  if (Array.isArray(schema)) {
    schema = schema[0]
  }
  if (schema.type === 'json' && typeof schema.content === 'string') {
    schema = schema.content
  }
  const isRAMLType = typeof schema === 'object'
  let validate

  // RAML data types
  if (isRAMLType) {
    validate = ramlValidate(schema, options.RAMLVersion)

  // JSON schema
  } else {
    try {
      schema = JSON.parse(schema)

      // Convert draft-03 schema to 04.
      if (!options.ajv && JSON_SCHEMA_03.test(schema.$schema)) {
        schema = jsonSchemaCompatibility.v4(schema)
        schema.$schema = 'http://json-schema.org/draft-04/schema'
      }

      validate = options.ajv ? options.ajv.compile(schema) : ajv.compile(schema)
    } catch (err) {
      err.message = 'Unable to compile JSON schema for ' + method + ' ' + path + ': ' + err.message
      throw err
    }
  }

  return function ospreyJsonBody (req, res, next) {
    const result = validate(req.body)

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
 * @param  {webapi-parser.Payload}   body
 * @param  {String}   path
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function urlencodedBodyHandler (body, path, method, options) {
  const urlencodedBodyParser = require('body-parser').urlencoded({
    type: [],
    extended: false,
    limit: options.limit,
    parameterLimit: options.parameterLimit
  })

  const middleware = [urlencodedBodyParser]
  const params = (body && (body.formParameters || body.properties)) || undefined

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
  const sanitize = ramlSanitize(parameters)
  const validate = ramlValidate(parameters, options.RAMLVersion)

  return function ospreyUrlencodedBody (req, res, next) {
    const body = sanitize(req.body)
    const result = validate(body)

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
 * @param  {webapi-parser.Payload}   body
 * @param  {String}   path
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function xmlBodyHandler (body, path, method, options) {
  const xmlParser = xmlBodyParser(options)
  const middleware = [xmlParser]

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
  const libxml = getLibXml()
  const bodyParser = require('body-parser').text({ type: [], limit: options.limit })

  // Parse the request body text.
  function xmlParser (req, res, next) {
    let xml

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
  let libxml

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
  const libxml = getLibXml()
  let schema

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
 * @param  {webapi-parser.Payload}   body
 * @param  {String}   path
 * @param  {String}   method
 * @param  {Object}   options
 * @return {Function}
 */
function formDataBodyHandler (body, path, method, options) {
  const Busboy = require('busboy')
  const params = (body && (body.formParameters || body.properties)) || {}
  const validators = {}
  const sanitizers = {}

  // Asynchonously sanitizes and validates values.
  Object.keys(params).forEach(function (key) {
    const param = extend(params[key], { repeat: false })

    sanitizers[key] = ramlSanitize.rule(param)
    validators[key] = ramlValidate.rule(param)
  })

  return function ospreyMethodForm (req, res, next) {
    const received = {}
    let errored = false
    const busboy = req.form = new Busboy({ headers: req.headers, limits: options.busboyLimits })
    const errors = {}

    // Override `emit` to provide validations. Only validate when
    // `formParameters` (or RAML 1.0 `properties`) are set.
    if (body && (body.formParameters || body.properties)) {
      busboy.emit = function emit (type, name, value, a, b, c) {
        const close = type === 'field' ? noop : function () {
          value.resume()
        }

        if (type === 'field' || type === 'file') {
          if (!Object.prototype.hasOwnProperty.call(params, name)) {
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
          const result = validators[name](value, name)

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

          const validationErrors = Object.keys(params)
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
  const self = createError(400, 'Request failed to validate against RAML definition')

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

function formatRamlValidationReport (report, type) {
  return report.results.map(result => {
    return {
      type: type,
      keyword: result.source.keyword,
      targetProperty: result.targetProperty,
      level: result.level,
      message: `invalid ${type}: ${result.message} (${result.source.keyword})`
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
