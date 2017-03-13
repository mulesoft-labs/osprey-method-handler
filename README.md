# Osprey Method Handler

[![NPM version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]

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
var express = require('express')
var handler = require('osprey-method-handler')
var app = express()

app.post('/users', handler({
  headers: {},
  responses: {
    '200': {
      body: {
        'application/json': {
          schema: '...',
          example: '...'
        }
      }
    }
  },
  body: {
    'application/json': {
      schema: '...'
    }
  }
}, '/users', 'POST', { /* ... */ }), function (req, res) {
  res.send('success')
})
```

Accepts the RAML schema as the first argument, method and path in subsequent arguments (mostly for debugging) and options as the final argument.

**Options**

* `discardUnknownBodies` Discard undefined request streams (default: `true`)
* `discardUnknownQueryParameters` Discard undefined query parameters (default: `true`)
* `discardUnknownHeaders` Discard undefined header parameters (always includes known headers) (default: `true`)
* `parseBodiesOnWildcard` Toggle parsing bodies on wildcard body support (default: `false`)
* `reviver` The [reviver](https://github.com/expressjs/body-parser#reviver) passed to `JSON.parse` for JSON endpoints
* `limit` The [maximum bytes](https://github.com/expressjs/body-parser#limit-2) for XML, JSON and URL-encoded endpoints (default: `'100kb'`)
* `parameterLimit` The [maximum number](https://github.com/expressjs/body-parser#parameterlimit) of URL-encoded parameters (default: `1000`)
* `busboyLimits` The multipart limits defined by [Busboy](https://github.com/mscdex/busboy#busboy-methods)
* `RAMLVersion` The RAML version passed to [raml-validate](https://github.com/mulesoft/node-raml-validate) (default: `'RAML08'`)

### Adding JSON schemas

If you are using external JSON schemas with `$ref`, you can add them to the module before you compile the middleware. Use `handler.addJsonSchema(schema, key)` to compile automatically when used.

### Validation Errors

The library intercepts incoming requests and does validation. It will respond with `400`, `406` or `415` error instances from [http-errors](https://github.com/jshttp/http-errors). Validation errors are attached to `400` instances and noted using `ramlValidation = true` and `requestErrors = []` (an array of errors that were found, compatible with [request-error-handler](https://github.com/mulesoft-labs/node-request-error-handler)).

The errors object format is:

```ts
interface Error {
  type: 'json' | 'form' | 'headers' | 'query' | 'xml'
  message: string
  keyword: string
  dataPath: string
  data: any
  schema: any
  meta?: Object
}
```

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
