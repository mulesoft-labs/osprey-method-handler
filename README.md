# Osprey Method Handler

[![NPM version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]

Middleware for validating requests and responses based on a [RAML method](https://github.com/raml-org/raml-spec/blob/master/raml-0.8.md#methods) object.

## Installation

```sh
npm install osprey-method-handler --save
```

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
