# Osprey Method Handler

[![NPM version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]

Middleware for validating requests and responses based on a [RAML method](https://github.com/raml-org/raml-spec/blob/master/raml-0.8.md#methods) object.

## Installation

```
npm install osprey-method-handler --save
```

## Features

* Header validation (ignores undocumented headers)
* Query validation (ignores undocumented parameters)
* Request body validation
  * JSON schemas
  * XML schemas
  * URL-encoded `formParameters` (ignores undocumented parameters)
  * Multipart form data `formParameters` (ignores undocumented parameters)
* Accept content type negotiation (based on defined success response bodies)
* Automatically parsed request bodies
  * JSON (`req.body`)
  * URL-encoded (`req.body`)
  * XML ([`req.xml`](https://github.com/polotek/libxmljs))
  * Form Data (`req.form` using [Busboy](https://github.com/mscdex/busboy), but you need to pipe the request into it - `req.pipe(req.form)`)

## Usage

```js
var express = require('express');
var handler = require('osprey-method-handler');
var app = express();

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
}), function (req, res) {
  res.send('success');
});
```

### Validation Errors

The library intercepts incoming requests and does validation. It will respond with `400`, `406` and `415` error instances from [http-errors](https://github.com/jshttp/http-errors). Validation errors are attached to `400` instances and noted using `validationType = 'json' | 'xml' | 'form' | 'query'` and `validationErrors = []` (an array of errors that were found).

To create custom error messages for your application, you can handle the errors using Express, Connect or any other error callback handler.

## Notes

There is an optional dependency on `libxmljs`. If you want XSD validation, you will need to install it.

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
