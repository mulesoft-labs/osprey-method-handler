/* global describe, it */
/* eslint-disable no-unused-expressions */

const expect = require('chai').expect
const sinon = require('sinon')
const router = require('osprey-router')
const fs = require('fs')
const join = require('path').join
const streamEqual = require('stream-equal')
const Ajv = require('ajv')
const handler = require('../')
const FormData = require('form-data')

/* Helps using popsicle-server with popsicle version 12+.
 *
 * Inspired by popsicle 12.0+ code.
 */
function makeFetcher (app) {
  const compose = require('throwback').compose
  const Request = require('servie').Request
  const popsicle = require('popsicle')
  const popsicleServer = require('popsicle-server')
  const finalhandler = require('finalhandler')

  // Set response text to "body" property to mimic popsicle v10
  // response interface.

  function responseBodyMiddleware (req, next) {
    return next().then(res => {
      return res.text().then(body => {
        res.body = body
        return res
      })
    })
  }

  function createServer (router) {
    return function (req, res) {
      router(req, res, finalhandler(req, res))
    }
  }

  const popsicleServerMiddleware = popsicleServer(createServer(app))
  const middleware = compose([
    responseBodyMiddleware,
    popsicleServerMiddleware,
    popsicle.middleware
  ])

  return {
    fetch: popsicle.toFetch(middleware, Request)
  }
}

describe('osprey method handler', function () {
  it('should return a middleware function', function () {
    const middleware = handler()

    expect(middleware).to.be.a('function')
    expect(middleware.length).to.equal(3)
  })

  describe('headers', function () {
    it('should reject invalid headers using standard error format', function () {
      const app = router()

      app.get('/', handler({
        headers: {
          'X-Header': {
            type: 'integer'
          }
        }
      }, '/', 'GET'))

      app.use(function (err, req, res, next) {
        expect(err.ramlValidation).to.equal(true)
        expect(err.requestErrors).to.deep.equal([
          {
            type: 'header',
            keyword: 'type',
            dataPath: 'x-header',
            message: 'invalid header (type, integer)',
            schema: 'integer',
            data: 'abc'
          }
        ])

        return next(err)
      })

      return makeFetcher(app).fetch('/', {
        method: 'GET',
        headers: {
          'X-Header': 'abc'
        }
      })
        .then(function (res) {
          expect(res.status).to.equal(400)
        })
    })

    it('should sanitize RAML 0.8 headers', function () {
      const app = router()

      app.get('/', handler({
        headers: {
          date: {
            type: 'date'
          }
        }
      }, '/', 'GET', { RAMLVersion: 'RAML08' }), function (req, res) {
        expect(req.headers.date).to.be.an.instanceOf(Date)

        res.end('success')
      })
      return makeFetcher(app).fetch('/', {
        method: 'GET',
        headers: {
          date: new Date().toString()
        }
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should sanitize RAML 1.0 headers', function () {
      const app = router()

      app.get('/', handler({
        headers: {
          date: {
            type: 'datetime',
            format: 'rfc2616'
          }
        }
      }, '/', 'GET', { RAMLVersion: 'RAML10' }), function (req, res) {
        expect(req.headers.date).to.equal(new Date(req.headers.date).toUTCString())

        res.end('success')
      })
      return makeFetcher(app).fetch('/', {
        method: 'GET',
        headers: {
          date: new Date().toUTCString()
        }
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })
  })

  describe('query parameters', function () {
    it('should reject invalid query parameters using standard error format', function () {
      const app = router()

      app.get('/', handler({
        queryParameters: {
          a: {
            type: 'string'
          },
          b: {
            type: 'integer'
          }
        }
      }, '/', 'GET'))

      app.use(function (err, req, res, next) {
        expect(err.ramlValidation).to.equal(true)
        expect(err.requestErrors).to.deep.equal([
          {
            type: 'query',
            keyword: 'type',
            dataPath: 'b',
            message: 'invalid query (type, integer)',
            schema: 'integer',
            data: 'value'
          }
        ])

        return next(err)
      })

      return makeFetcher(app).fetch('/?a=value&b=value', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.status).to.equal(400)
        })
    })

    it('should filter undefined query parameters', function () {
      const app = router()

      app.get('/', handler({
        queryParameters: {
          a: {
            type: 'string'
          }
        }
      }, '/', 'GET'), function (req, res) {
        expect(req.url).to.equal('/?a=value')
        expect(req.query).to.deep.equal({ a: 'value' })

        res.end('success')
      })

      return makeFetcher(app).fetch('/?a=value&b=value', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should remove all unknown query parameters', function () {
      const app = router()

      app.get('/', handler({
        queryParameters: {
          q: {
            type: 'string',
            required: false
          }
        }
      }, '/', 'GET'), function (req, res) {
        expect(req.url).to.equal('/')
        expect(req.query).to.deep.equal({})

        res.end('success')
      })

      return makeFetcher(app).fetch('/?a=value&b=value', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should not filter undefined query parameters when discardUnknownQueryParameters is false', function () {
      const app = router()

      app.get('/', handler({
        queryParameters: {
          a: {
            type: 'string'
          }
        }
      }, '/', 'GET', { discardUnknownQueryParameters: false }), function (req, res) {
        expect(req.url).to.equal('/?a=value&b=value')
        expect(req.query).to.deep.equal({ a: 'value' })

        res.end('success')
      })

      return makeFetcher(app).fetch('/?a=value&b=value', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should support empty query strings', function () {
      const app = router()

      app.get('/', handler({
        queryParameters: {
          test: {
            type: 'boolean',
            required: false
          }
        }
      }, '/', 'GET'), function (req, res) {
        expect(req.url).to.equal('/')
        expect(req.query).to.deep.equal({})

        res.end('success')
      })

      return makeFetcher(app).fetch('/', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should parse requests using array query syntax (RAML 0.8)', function () {
      const app = router()

      app.get('/', handler({
        queryParameters: {
          foo: {
            type: 'string',
            repeat: true
          }
        }
      }, '/', 'GET', { RAMLVersion: 'RAML08' }), function (req, res) {
        expect(req.url).to.equal('/?foo=a&foo=b&foo=c')
        expect(req.query).to.deep.equal({ foo: ['a', 'b', 'c'] })

        res.end('success')
      })

      return makeFetcher(app).fetch('/?foo[]=a&foo[1]=b&foo[22]=c', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should parse requests using array query syntax (RAML 1.0)', function () {
      const app = router()

      app.get('/', handler({
        queryParameters: {
          foo: {
            type: 'array'
          }
        }
      }, '/', 'GET', { RAMLVersion: 'RAML10' }), function (req, res) {
        expect(req.url).to.equal('/?foo=a&foo=b&foo=c')
        expect(req.query).to.deep.equal({ foo: ['a', 'b', 'c'] })

        res.end('success')
      })

      return makeFetcher(app).fetch('/?foo=["a","b","c"]', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should unescape querystring keys', function () {
      const app = router()

      app.get('/', handler({
        queryParameters: {
          'foo[bar]': {
            type: 'string'
          }
        }
      }, '/', 'GET'), function (req, res) {
        expect(req.url).to.equal('/?foo%5Bbar%5D=test')
        expect(req.query).to.deep.equal({ 'foo[bar]': 'test' })

        res.end('success')
      })

      return makeFetcher(app).fetch('/?foo[bar]=test', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should support unused repeat parameters (mulesoft/osprey#84)', function () {
      const app = router()

      app.get('/', handler({
        queryParameters: {
          instance_state_name: {
            type: 'string',
            repeat: true,
            required: false
          }
        }
      }, '/', 'GET', { RAMLVersion: 'RAML08' }), function (req, res) {
        expect(req.url).to.equal('/')
        expect(req.query).to.deep.equal({ instance_state_name: [] })

        res.end('success')
      })

      return makeFetcher(app).fetch('/', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })
  })

  describe('body', function () {
    describe('general', function () {
      it('should parse content-type from header and validate', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: '{}'
            }
          }
        }, '/', 'POST'), function (req, res) {
          expect(req.body).to.deep.equal({ foo: 'bar' })

          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            foo: 'bar'
          })
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('raml datatype', function () {
      const RAML_DT = {
        foo: {
          name: 'foo',
          displayName: 'foo',
          type: ['string'],
          required: true
        }
      }

      it('should reject invalid RAML datatype with standard error format', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              properties: RAML_DT
            }
          }
        }))

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors).to.deep.equal([
            {
              type: 'json',
              keyword: 'required',
              dataPath: 'foo',
              message: 'invalid json (required, true)',
              schema: true,
              data: undefined
            }
          ])
          return next(err)
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: '{}'
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should reject properties < minProperties', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              properties: RAML_DT,
              minProperties: 2
            }
          }
        }))

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors).to.deep.equal([
            {
              type: 'json',
              keyword: 'minProperties',
              dataPath: undefined,
              message: 'invalid json (minProperties, 2)',
              schema: 2,
              data: undefined
            }
          ])
          return next(err)
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            foo: 'bar'
          })
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should reject properties > maxProperties', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              properties: RAML_DT,
              maxProperties: 1
            }
          }
        }))

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors).to.deep.equal([
            {
              type: 'json',
              keyword: 'maxProperties',
              dataPath: undefined,
              message: 'invalid json (maxProperties, 1)',
              schema: 1,
              data: undefined
            }
          ])
          return next(err)
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            foo: 'bar',
            baz: 'qux'
          })
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })
      it('should reject additional properties when additionalProperties is false', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              properties: RAML_DT,
              additionalProperties: false
            }
          }
        }))

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors).to.deep.equal([
            {
              type: 'json',
              keyword: 'additionalProperties',
              dataPath: undefined,
              message: 'invalid json (additionalProperties, false)',
              schema: false,
              data: undefined
            }
          ])
          return next(err)
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            foo: 'bar',
            baz: 'qux'
          })
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })
      it('should accept valid RAML datatype', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              properties: RAML_DT,
              minProperties: 1,
              maxProperties: 1,
              additionalProperties: false
            }
          }
        }, '/', 'POST'), function (req, res) {
          expect(req.body).to.deep.equal({ foo: 'bar' })

          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            foo: 'bar'
          })
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })

      it('should accept arrays as root elements', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              type: ['array'],
              items: 'string'
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML10' }), function (req, res) {
          expect(req.body).to.deep.equal(['a', 'b', 'c'])

          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify(['a', 'b', 'c'])
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
      it('should reject objects when an array is set as root element', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              type: ['array'],
              items: 'string'
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML10' }), function (req, res) {
          res.end('failure')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            foo: 'bar'
          })
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should accept strings as root elements', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              type: ['string']
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML10' }), function (req, res) {
          expect(req.body).to.equal('test')

          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: '"test"'
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
      it('should reject objects when a string is set as root element', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              type: ['string']
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML10' }), function (req, res) {
          res.send('failure')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            foo: 'bar'
          })
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should accept objects with empty properties', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              type: ['object'],
              properties: {}
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML10' }), function (req, res) {
          expect(req.body).to.deep.equal({ foo: 'bar' })

          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            foo: 'bar'
          })
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
      it('should reject invalid objects', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              type: ['object'],
              properties: {}
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML10' }), function (req, res) {
          res.send('failure')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: '"foo"'
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })
    })

    describe('json', function () {
      const JSON_SCHEMA = '{"properties":{"x":{"type":"string"}},"required":["x"]}'

      it('should reject invalid json with standard error format', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: JSON_SCHEMA
            }
          }
        }))

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors).to.deep.equal([
            {
              type: 'json',
              keyword: 'required',
              dataPath: '/x',
              message: 'is a required property',
              schema: { x: { type: 'string' } },
              data: {}
            }
          ])

          return next(err)
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8'
          },
          body: '{}'
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should reject invalid request bodies', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: JSON_SCHEMA
            }
          }
        }))

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          body: 'foobar',
          headers: {
            'Content-Type': 'application/json'
          }
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should parse valid json', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              // 'schema' and 'type' are synonymous in RAML 1.0
              type: JSON_SCHEMA
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML10' }), function (req, res) {
          expect(req.body).to.deep.equal([true, false])

          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([true, false])
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })

      it('should validate using draft 03', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: JSON.stringify({
                required: true,
                $schema: 'http://json-schema.org/draft-03/schema',
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    required: true
                  }
                }
              })
            }
          }
        }))

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          body: '{"url":"http://example.com"}',
          headers: {
            'Content-Type': 'application/json'
          }
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should use a custom ajv instance for validation if provided in options', function () {
        const ajv = Ajv({
          schemaId: 'auto',
          allErrors: true,
          verbose: true,
          jsonPointers: true,
          errorDataPath: 'property'
        })

        const compile = sinon.spy(ajv, 'compile')

        const schema = {
          $schema: 'http://json-schema.org/draft-07/schema',
          type: 'object',
          properties: {
            name: {
              type: 'string'
            }
          },
          required: [
            'name'
          ]
        }
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: JSON.stringify(schema)
            }
          }
        },
        null,
        null,
        { ajv }
        ))

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          body: '{"url":"http://example.com"}',
          headers: {
            'Content-Type': 'application/json'
          }
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
            sinon.assert.calledWith(compile, schema)
          })
      })

      it('should support external $ref when added', function () {
        const schema = JSON.stringify({
          $schema: 'http://json-schema.org/draft-04/schema#',
          title: 'Product set',
          type: 'array',
          items: {
            title: 'Product',
            type: 'object',
            properties: {
              id: {
                description: 'The unique identifier for a product',
                type: 'number'
              },
              name: {
                type: 'string'
              },
              price: {
                type: 'number',
                minimum: 0,
                exclusiveMinimum: true
              },
              tags: {
                type: 'array',
                items: {
                  type: 'string'
                },
                minItems: 1,
                uniqueItems: true
              },
              dimensions: {
                type: 'object',
                properties: {
                  length: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' }
                },
                required: ['length', 'width', 'height']
              },
              warehouseLocation: {
                description: 'Coordinates of the warehouse with the product',
                $ref: 'http://json-schema.org/geo'
              }
            },
            required: ['id', 'name', 'price']
          }
        })

        const app = router()

        // Register GeoJSON schema.
        handler.addJsonSchema(
          require('./vendor/geo.json'),
          'http://json-schema.org/geo'
        )

        app.post('/', handler({
          body: {
            'application/json': {
              schema: schema
            }
          }
        }), function (req, res) {
          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([{
            id: 123,
            name: 'Product',
            price: 12.34,
            tags: ['foo', 'bar'],
            warehouseLocation: {
              latitude: 123,
              longitude: 456
            }
          }])
        })
          .then(function (res) {
            expect(res.status).to.equal(200)
          })
      })

      it('should support external $ref with a custom ajv instance', function () {
        const ajv = Ajv({
          schemaId: 'auto',
          allErrors: true,
          verbose: true,
          jsonPointers: true,
          errorDataPath: 'property'
        })
        ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-04.json'))

        const addSchema = sinon.spy(ajv, 'addSchema')

        const schema = JSON.stringify({
          $schema: 'http://json-schema.org/draft-04/schema#',
          title: 'Product set',
          type: 'array',
          items: {
            title: 'Product',
            type: 'object',
            properties: {
              id: {
                description: 'The unique identifier for a product',
                type: 'number'
              },
              name: {
                type: 'string'
              },
              price: {
                type: 'number',
                minimum: 0,
                exclusiveMinimum: true
              },
              tags: {
                type: 'array',
                items: {
                  type: 'string'
                },
                minItems: 1,
                uniqueItems: true
              },
              dimensions: {
                type: 'object',
                properties: {
                  length: { type: 'number' },
                  width: { type: 'number' },
                  height: { type: 'number' }
                },
                required: ['length', 'width', 'height']
              },
              warehouseLocation: {
                description: 'Coordinates of the warehouse with the product',
                $ref: 'http://json-schema.org/geo'
              }
            },
            required: ['id', 'name', 'price']
          }
        })

        const app = router()

        // Register GeoJSON schema.
        handler.addJsonSchema(
          require('./vendor/geo.json'),
          'http://json-schema.org/geo',
          { ajv }
        )

        app.post('/', handler({
          body: {
            'application/json': {
              schema: schema
            }
          }
        }, null, null, { ajv }
        ), function (req, res) {
          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          body: JSON.stringify([{
            id: 123,
            name: 'Product',
            price: 12.34,
            tags: ['foo', 'bar'],
            warehouseLocation: {
              latitude: 123,
              longitude: 456
            }
          }]),
          headers: { 'Content-Type': 'application/json' }
        })
          .then(function (res) {
            expect(res.status).to.equal(200)
            sinon.assert.calledOnce(addSchema)
          })
      })

      it('should reject invalid schema', function () {
        expect(function () {
          handler({
            body: {
              'application/json': {
                schema: JSON.stringify({
                  $schema: 'http://invalid'
                })
              }
            }
          }, '/foo')
        }).to.throw(/^Unable to compile JSON schema/)
      })
    })

    if (hasModule('libxmljs')) {
      describe('xml', function () {
        const XML_SCHEMA = [
          '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">',
          '<xs:element name="comment"><xs:complexType><xs:all>',
          '<xs:element name="author" type="xs:string"/>',
          '<xs:element name="content" type="xs:string"/>',
          '</xs:all></xs:complexType></xs:element>',
          '</xs:schema>'
        ].join('')

        it('should error creating middleware with invalid xml', function () {
          expect(function () {
            handler({
              body: {
                'text/xml': {
                  schema: 'foobar'
                }
              }
            }, '/foo')
          }).to.throw(/^Unable to compile XML schema/)
        })

        it('should reject invalid xml bodies with standard error format', function () {
          const app = router()

          app.post('/', handler({
            body: {
              'text/xml': {
                schema: XML_SCHEMA
              }
            }
          }))

          app.use(function (err, req, res, next) {
            expect(err.ramlValidation).to.equal(true)
            expect(err.requestErrors).to.deep.equal([
              {
                type: 'xml',
                message: 'Element \'date\': This element is not expected. Expected is ( content ).\n',
                meta: {
                  domain: 17,
                  code: 1871,
                  level: 2,
                  column: 0,
                  line: 4
                }
              }
            ])

            return next(err)
          })

          return makeFetcher(app).fetch('/', {
            method: 'POST',
            body: [
              '<?xml version="1.0"?>',
              '<comment>',
              '  <author>author</author>',
              '  <date>2015-08-19</date>',
              '</comment>'
            ].join('\n'),
            headers: {
              'Content-Type': 'text/xml'
            }
          })
            .then(function (res) {
              expect(res.status).to.equal(400)
            })
        })

        it('should reject invalid request bodies', function () {
          const app = router()

          app.post('/', handler({
            body: {
              'text/xml': {
                schema: XML_SCHEMA
              }
            }
          }))

          return makeFetcher(app).fetch('/', {
            method: 'POST',
            body: 'foobar',
            headers: {
              'Content-Type': 'text/xml'
            }
          })
            .then(function (res) {
              expect(res.status).to.equal(400)
            })
        })

        it('should parse valid xml documents', function () {
          const app = router()

          app.post('/', handler({
            body: {
              'text/xml': {
                schema: XML_SCHEMA
              }
            }
          }), function (req, res) {
            expect(req.xml.get('/comment/author').text()).to.equal('author')
            expect(req.xml.get('/comment/content').text()).to.equal('nothing')

            res.end('success')
          })

          return makeFetcher(app).fetch('/', {
            method: 'POST',
            body: [
              '<?xml version="1.0"?>',
              '<comment>',
              '  <author>author</author>',
              '  <content>nothing</content>',
              '</comment>'
            ].join('\n'),
            headers: {
              'Content-Type': 'text/xml'
            }
          })
            .then(function (res) {
              expect(res.body).to.equal('success')
              expect(res.status).to.equal(200)
            })
        })
      })
    }

    describe('urlencoded', function () {
      it('should reject invalid forms with standard error format', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/x-www-form-urlencoded': {
              formParameters: {
                a: {
                  type: 'boolean'
                }
              }
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML10' }))

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors).to.deep.equal([
            {
              type: 'form',
              keyword: 'type',
              dataPath: 'a',
              message: 'invalid form (type, boolean)',
              schema: 'boolean',
              data: ['true', '123']
            }
          ])

          return next(err)
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          body: 'a=true&a=123',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should parse valid forms (RAML 0.8)', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/x-www-form-urlencoded': {
              formParameters: {
                a: {
                  type: 'boolean',
                  repeat: true
                }
              }
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML08' }), function (req, res) {
          expect(req.body).to.deep.equal({ a: [true, true] })

          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          body: 'a=true&a=123',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })

      it('should parse valid forms (RAML 1.0)', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/x-www-form-urlencoded': {
              formParameters: {
                a: {
                  type: 'array',
                  items: 'boolean'
                }
              }
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML10' }), function (req, res) {
          expect(req.body).to.deep.equal({ a: [true, true] })

          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          body: 'a=[true,true]',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('form data', function () {
      it('should reject invalid forms using standard error format', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'multipart/form-data': {
              formParameters: {
                username: {
                  type: 'string',
                  pattern: '^[a-zA-Z]\\w*$'
                }
              }
            }
          }
        }), function (req, res, next) {
          req.form.on('error', next)

          req.pipe(req.form)
        })

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors).to.deep.equal([
            {
              type: 'form',
              keyword: 'pattern',
              dataPath: 'username',
              message: 'invalid form (pattern, ^[a-zA-Z]\\w*$)',
              schema: '^[a-zA-Z]\\w*$',
              data: '123'
            }
          ])

          return next(err)
        })

        const form = new FormData()
        form.append('username', '123')

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: form.getHeaders(),
          body: form
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should parse valid forms', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'multipart/form-data': {
              formParameters: {
                username: {
                  type: 'string',
                  pattern: '[a-zA-Z]\\w*'
                }
              }
            }
          }
        }), function (req, res) {
          req.form.on('field', function (name, value) {
            expect(name).to.equal('username')
            expect(value).to.equal('blakeembrey')

            res.end('success')
          })

          req.pipe(req.form)
        })

        const form = new FormData()
        form.append('username', 'blakeembrey')

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: form.getHeaders(),
          body: form
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })

      it('should properly sanitize form values', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'multipart/form-data': {
              formParameters: {
                number: {
                  type: 'number'
                }
              }
            }
          }
        }), function (req, res) {
          req.form.on('field', function (name, value) {
            expect(name).to.equal('number')
            expect(value).to.equal(12345)

            res.end('success')
          })

          req.pipe(req.form)
        })

        const form = new FormData()
        form.append('number', '12345')

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: form.getHeaders(),
          body: form
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })

      it('should error with repeated values', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'multipart/form-data': {
              formParameters: {
                item: {
                  type: 'string'
                }
              }
            }
          }
        }), function (req, res, next) {
          req.form.on('error', next)

          req.pipe(req.form)
        })

        const form = new FormData()
        form.append('item', 'abc')
        form.append('item', '123')

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: form.getHeaders(),
          body: form
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should error if it did not receive all required values', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'multipart/form-data': {
              formParameters: {
                item: {
                  type: 'string',
                  required: true
                },
                more: {
                  type: 'string'
                }
              }
            }
          }
        }), function (req, res, next) {
          req.form.on('error', next)

          req.pipe(req.form)
        })

        const form = new FormData()
        form.append('more', '123')

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: form.getHeaders(),
          body: form
        })
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should allow files', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'multipart/form-data': {
              formParameters: {
                contents: {
                  type: 'file',
                  fileTypes: ['*/*']
                },
                filename: {
                  type: 'string'
                }
              }
            }
          }
        }), function (req, res) {
          req.form.on('field', function (name, value) {
            expect(name).to.equal('filename')
            expect(value).to.equal('LICENSE')
          })

          req.form.on('file', function (name, stream) {
            expect(name).to.equal('contents')

            streamEqual(
              stream,
              fs.createReadStream(join(__dirname, '..', 'LICENSE')),
              function (err, equal) {
                expect(equal).to.equal(true)

                return err ? res.end() : res.end('success')
              }
            )
          })

          req.pipe(req.form)
        })

        const form = new FormData()
        form.append('contents', fs.createReadStream(join(__dirname, '..', 'LICENSE')))
        form.append('filename', 'LICENSE')

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: form.getHeaders(),
          body: form
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })

      it('should ignore unknown files and fields (RAML 0.8)', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'multipart/form-data': {
              formParameters: {
                file: {
                  type: 'file'
                }
              }
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML08' }), function (req, res) {
          let callCount = 0

          function called (name, value) {
            callCount++
            expect(name).to.equal('file')
            expect(value).to.be.an('object')
          }

          req.form.on('field', called)

          req.form.on('file', function (name, stream) {
            called(name, stream)

            stream.resume()
          })

          req.form.on('finish', function () {
            expect(callCount).to.equal(1)

            res.end('success')
          })

          req.pipe(req.form)
        })

        const form = new FormData()
        form.append('file', fs.createReadStream(join(__dirname, '..', 'LICENSE')))
        form.append('another', fs.createReadStream(join(__dirname, '..', 'README.md')))
        form.append('random', 'hello world')

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: form.getHeaders(),
          body: form
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('unknown', function () {
      it('should reject unknown request types', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: '{"items":{"type":"boolean"}}'
            }
          }
        }))

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          body: 'test',
          headers: {
            'Content-Type': 'text/html'
          }
        })
          .then(function (res) {
            expect(res.status).to.equal(415)
          })
      })

      it('should pass unknown bodies through when defined', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'text/html': null
          }
        }), function (req, res) {
          res.end('success')
        })

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          body: 'test',
          headers: {
            'Content-Type': 'text/html'
          }
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('multiple', function () {
      it('should parse as the correct content type', function () {
        const app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: '{"properties":{"items":{"type":"string"}}' +
                ',"required":["items"]}'
            },
            'multipart/form-data': {
              formParameters: {
                items: {
                  type: 'boolean',
                  repeat: true
                }
              }
            }
          }
        }, '/', 'POST', { RAMLVersion: 'RAML08' }), function (req, res) {
          let callCount = 0

          req.form.on('field', function (name, value) {
            callCount++

            expect(name).to.equal('items')
            expect(value).to.equal(callCount === 1)
          })

          req.form.on('finish', function () {
            expect(callCount).to.equal(2)

            res.end('success')
          })

          req.pipe(req.form)
        })

        const form = new FormData()
        form.append('items', 'true')
        form.append('items', 'false')

        return makeFetcher(app).fetch('/', {
          method: 'POST',
          headers: form.getHeaders(),
          body: form
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('empty', function () {
      it('should discard empty request bodies', function () {
        const app = router()

        app.post('/', handler({}), function (req, res) {
          return req._readableState.ended ? res.end() : req.pipe(res)
        })

        const form = new FormData()
        form.append('file', fs.createReadStream(join(__dirname, 'index.js')))

        return makeFetcher(app).fetch('/', {
          body: form,
          headers: form.getHeaders(),
          method: 'POST'
        })
          .then(function (res) {
            expect(res.body).to.equal('')
            expect(res.status).to.equal(200)
          })
      })
    })

    it('should disable discard empty request', function () {
      const app = router()

      app.post(
        '/',
        handler(null, '/', 'POST', { discardUnknownBodies: false }),
        function (req, res) {
          return req.pipe(res)
        }
      )

      return makeFetcher(app).fetch('/', {
        body: 'test',
        method: 'POST'
      })
        .then(function (res) {
          expect(res.body).to.equal('test')
          expect(res.status).to.equal(200)
        })
    })
  })

  describe('wildcard', function () {
    it('should accept any body', function () {
      const app = router()

      app.post('/', handler({
        body: {
          '*/*': null
        }
      }, '/', 'POST'), function (req, res) {
        return req.pipe(res)
      })

      const form = new FormData()
      form.append('file', fs.createReadStream(join(__dirname, 'index.js')))

      return makeFetcher(app).fetch('/', {
        body: form,
        headers: form.getHeaders(),
        method: 'POST'
      })
        .then(function (res) {
          expect(typeof res.body).to.equal('string')
          expect(res.status).to.equal(200)
        })
    })
  })

  describe('accept', function () {
    it('should reject requests with invalid accept headers', function () {
      const app = router()

      app.get('/', handler({
        responses: {
          200: {
            body: {
              'text/html': null
            }
          }
        }
      }))

      return makeFetcher(app).fetch('/', {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      })
        .then(function (res) {
          expect(res.status).to.equal(406)
        })
    })

    it('should accept requests with valid accept headers', function () {
      const app = router()

      app.get('/', handler({
        responses: {
          200: {
            body: {
              'text/html': null
            }
          }
        }
      }), function (req, res) {
        expect(req.headers.accept).to.equal('application/json, text/html')

        res.end('success')
      })

      return makeFetcher(app).fetch('/', {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/html'
        }
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should accept anything without response types', function () {
      const app = router()

      app.get('/', handler({
        responses: {
          200: {
            body: {}
          }
        }
      }), function (req, res) {
        expect(req.headers.accept).to.equal('foo/bar')

        res.end('success')
      })

      return makeFetcher(app).fetch('/', {
        method: 'GET',
        headers: {
          Accept: 'foo/bar'
        }
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })
  })
})

/**
 * Check for module existence.
 */
function hasModule (module) {
  try {
    require.resolve(module)
  } catch (err) {
    return false
  }

  return true
}
