# Osprey Method Handler

[![NPM version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]
[![Greenkeeper badge](https://badges.greenkeeper.io/mulesoft-labs/osprey-method-handler.svg)](https://greenkeeper.io/)

Middleware for validating requests and responses based on a RAML method object.

## Installation

```
npm install osprey-method-handler --save
```

## Features

* Supports RAML 0.8 and RAML 1.0
* Header validation (ignores undocumented headers)
* Query validation (ignores undocumented parameters)
* Request body validation
  * JSON schemas
  * XML schemas
  * URL-encoded `formParameters` (ignores undocumented parameters)
  * Multipart form data `formParameters` (ignores undocumented parameters)
  * Discards unknown bodies
* Accept content type negotiation (based on defined success response bodies)
* Automatically parsed request bodies
  * JSON (`req.body`)
  * URL-encoded (`req.body`)
  * XML ([`req.xml`](https://github.com/polotek/libxmljs))
  * Form Data (`req.form` using [Busboy](https://github.com/mscdex/busboy), but you need to pipe the request into it - `req.pipe(req.form)`)

**Please note:** Due to the build time of `libxmljs`, it does not come bundled. If you need XML validation, please install `libxmljs` as a dependency of your own project.

## Usage

```js
const express = require('express')
const handler = require('osprey-method-handler')
const utils = require('./utils')

const app = express()

// webapi-parser.Operation
const methodObj = utils.getMethodObj()
const options = {}

app.post(
  '/users',
  handler(methodObj, '/users', 'POST', options),
  function (req, res) {
    res.send('success')
  }
)
```
Accepts [webapi-parser](https://github.com/raml-org/webapi-parser) `Operation` object as first argument, path string as second argument, method name as third and options object as final argument.

**Options**

* `ajv` Custom [Ajv](https://github.com/epoberezkin/ajv) instance to be used to validate query strings, request headers and request bodied (url-encoded, form-data, json)
* `discardUnknownBodies` Discard undefined request streams (default: `true`)
* `discardUnknownQueryParameters` Discard undefined query parameters (default: `true`)
* `discardUnknownHeaders` Discard undefined header parameters (always includes known headers) (default: `true`)
* `parseBodiesOnWildcard` Toggle parsing bodies on wildcard body support (default: `false`)
* `reviver` The [reviver](https://github.com/expressjs/body-parser#reviver) passed to `JSON.parse` for JSON endpoints
* `limit` The [maximum bytes](https://github.com/expressjs/body-parser#limit-2) for XML, JSON and URL-encoded endpoints (default: `'100kb'`)
* `parameterLimit` The [maximum number](https://github.com/expressjs/body-parser#parameterlimit) of URL-encoded parameters (default: `1000`)
* `busboyLimits` The multipart limits defined by [Busboy](https://github.com/mscdex/busboy#busboy-methods)

### Adding JSON schemas

If you are using external JSON schemas with `$ref`, you can add them to the module before you compile the middleware. Use `handler.addJsonSchema(schema, key)` to compile automatically when used.

`handler.addJsonSchema()` accepts a third (optional) `options` argument. Supported `options` are:
* `ajv` Custom [Ajv](https://github.com/epoberezkin/ajv) instance. E.g. `handler.addJsonSchema(schema, key, {ajv: myAjvInstance})`. The provided ajv instance can later be passed as an option to the handler to perform validation.

### Validation Errors

The library intercepts incoming requests and does validation. It will respond with `400`, `406` or `415` error instances from [http-errors](https://github.com/jshttp/http-errors). Validation errors are attached to `400` instances and noted using `ramlValidation = true` and `requestErrors = []` (an array of errors that were found, compatible with [request-error-handler](https://github.com/mulesoft-labs/node-request-error-handler)).

See [the code](https://github.com/mulesoft-labs/osprey-method-handler/blob/7adb162035e4e593a5bbda8b3e83b1996adc2174/osprey-method-handler.js#L705-L751) for a complete list of errors formats.

**Please note:** XML validation does not have a way to get the `keyword`, `dataPath`, `data` or `schema`. Instead, it has a `meta` object that contains information from `libxmljs` (`domain`, `code`, `level`, `column`, `line`).

To render the error messages for your application, look into error handling for Express, Connect, Router or any other middleware error handler. If you want a pre-built error handler, try using [request-error-handler](https://github.com/mulesoft-labs/node-request-error-handler), which provides a pre-defined error formatter.

## License

MIT license

[npm-image]: https://img.shields.io/npm/v/osprey-method-handler.svg?style=flat
[npm-url]: https://npmjs.org/package/osprey-method-handler
[downloads-image]: https://img.shields.io/npm/dm/osprey-method-handler.svg?style=flat
[downloads-url]: https://npmjs.org/package/osprey-method-handler
[travis-image]: https://img.shields.io/travis/mulesoft-labs/osprey-method-handler.svg?style=flat
[travis-url]: https://travis-ci.org/mulesoft-labs/osprey-method-handler
[coveralls-image]: https://img.shields.io/coveralls/mulesoft-labs/osprey-method-handler.svg?style=flat
[coveralls-url]: https://coveralls.io/r/mulesoft-labs/osprey-method-handler?branch=master
