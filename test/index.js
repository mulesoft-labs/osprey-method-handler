/* global describe, it, before, context */

const expect = require('chai').expect
const fs = require('fs')
const join = require('path').join
const streamEqual = require('stream-equal')
const FormData = require('form-data')
const ospreyRouter = require('osprey-router')
const wp = require('webapi-parser')

const ospreyMethodHandler = require('../')

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

function makeRequestMethod (ct, schema) {
  return new wp.model.domain.Operation()
    .withMethod('GET')
    .withRequest(
      new wp.model.domain.Request().withPayloads([
        new wp.model.domain.Payload()
          .withMediaType(ct)
          .withSchema(schema)
      ])
    )
}

before(async function () {
  this.timeout(10000)
  await wp.WebApiParser.init()
})

describe('osprey method handler', function () {
  it('should return a middleware function', function () {
    const middleware = ospreyMethodHandler()

    expect(middleware).to.be.a('function')
    expect(middleware.length).to.equal(3)
  })

  describe('headers', function () {
    it('should reject invalid headers using standard error format', function () {
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withHeaders([
            new wp.model.domain.Parameter()
              .withName('X-Header')
              .withRequired(true)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#integer')
              )
          ])
        )

      app.get('/', ospreyMethodHandler(method, '/', 'GET'))

      app.use(function (err, req, res, next) {
        expect(err.ramlValidation).to.equal(true)
        expect(err.requestErrors[0]).to.deep.equal({
          type: 'header',
          keyword: 'type',
          dataPath: 'x-header',
          data: 'abc',
          level: 'Violation',
          message: 'invalid header: should be integer (type)'
        })

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

    it.skip('should sanitize RAML 0.8 headers', function () {
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withHeaders([
            new wp.model.domain.Parameter()
              .withName('date')
              .withRequired(true)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#date')
              )
          ])
        )

      const middleware = ospreyMethodHandler(
        method, '/', 'GET', { RAMLVersion: 'RAML08' })
      app.get('/', middleware, function (req, res) {
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

    it.skip('should sanitize RAML 1.0 headers', function () {
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withHeaders([
            new wp.model.domain.Parameter()
              .withName('date')
              .withRequired(true)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#datetime')
                  .withFormat('rfc2616')
              )
          ])
        )

      const middleware = ospreyMethodHandler(
        method, '/', 'GET', { RAMLVersion: 'RAML10' })
      app.get('/', middleware,
        function (req, res) {
          expect(req.headers.date).to.equal(new Date(req.headers.date).toUTCString())

          res.end('success')
        }
      )
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
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withQueryParameters([
            new wp.model.domain.Parameter()
              .withName('a')
              .withRequired(true)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              ),
            new wp.model.domain.Parameter()
              .withName('b')
              .withRequired(true)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#integer')
              )
          ])
        )

      app.get('/', ospreyMethodHandler(method, '/', 'GET'))

      app.use(function (err, req, res, next) {
        expect(err.ramlValidation).to.equal(true)
        expect(err.requestErrors[0]).to.deep.equal(
          {
            type: 'query',
            keyword: 'type',
            dataPath: 'b',
            data: 'value',
            level: 'Violation',
            message: 'invalid query: should be integer (type)'
          }
        )

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
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withQueryParameters([
            new wp.model.domain.Parameter()
              .withName('a')
              .withRequired(true)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              )
          ])
        )

      app.get('/', ospreyMethodHandler(method, '/', 'GET'),
        function (req, res) {
          expect(req.url).to.equal('/?a=value')
          expect(req.query).to.deep.equal({ a: 'value' })
          res.end('success')
        }
      )

      return makeFetcher(app).fetch('/?a=value&b=value', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should remove all unknown query parameters', function () {
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withQueryParameters([
            new wp.model.domain.Parameter()
              .withName('q')
              .withRequired(false)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              )
          ])
        )

      app.get('/', ospreyMethodHandler(method, '/', 'GET'),
        function (req, res) {
          expect(req.url).to.equal('/')
          expect(req.query).to.deep.equal({})

          res.end('success')
        }
      )

      return makeFetcher(app).fetch('/?a=value&b=value', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    context('when discardUnknownQueryParameters is false', function () {
      it('should not filter undefined query parameters', function () {
        const app = ospreyRouter()
        const method = new wp.model.domain.Operation()
          .withMethod('GET')
          .withRequest(
            new wp.model.domain.Request().withQueryParameters([
              new wp.model.domain.Parameter()
                .withName('a')
                .withRequired(true)
                .withSchema(
                  new wp.model.domain.ScalarShape()
                    .withName('schema')
                    .withDataType('http://www.w3.org/2001/XMLSchema#string')
                )
            ])
          )

        const middleware = ospreyMethodHandler(
          method, '/', 'GET', { discardUnknownQueryParameters: false })
        app.get('/', middleware,
          function (req, res) {
            expect(req.url).to.equal('/?a=value&b=value')
            expect(req.query).to.deep.equal({ a: 'value' })
            res.end('success')
          }
        )

        return makeFetcher(app).fetch('/?a=value&b=value', {
          method: 'GET'
        })
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    it('should support empty query strings', function () {
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withQueryParameters([
            new wp.model.domain.Parameter()
              .withName('test')
              .withRequired(false)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#boolean')
              )
          ])
        )

      app.get('/', ospreyMethodHandler(method, '/', 'GET'),
        function (req, res) {
          expect(req.url).to.equal('/')
          expect(req.query).to.deep.equal({})

          res.end('success')
        }
      )

      return makeFetcher(app).fetch('/', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it.skip('should parse requests using array query syntax (RAML 0.8)', function () {
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withQueryParameters([
            new wp.model.domain.Parameter()
              .withName('foo')
              .withRequired(true)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              )
          ])
        )
      /*
      {
        queryParameters: {
          foo: {
            type: 'string',
            repeat: true
          }
        }
      }
      */
      const middleware = ospreyMethodHandler(
        method, '/', 'GET', { RAMLVersion: 'RAML08' })
      app.get('/', middleware,
        function (req, res) {
          expect(req.url).to.equal('/?foo=a&foo=b&foo=c')
          expect(req.query).to.deep.equal({ foo: ['a', 'b', 'c'] })

          res.end('success')
        }
      )

      return makeFetcher(app).fetch('/?foo[]=a&foo[1]=b&foo[22]=c', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should parse requests using array query syntax (RAML 1.0)', function () {
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withQueryParameters([
            new wp.model.domain.Parameter()
              .withName('foo')
              .withRequired(true)
              .withSchema(
                new wp.model.domain.ArrayShape()
              )
          ])
        )

      const middleware = ospreyMethodHandler(
        method, '/', 'GET', { RAMLVersion: 'RAML10' })
      app.get('/', middleware,
        function (req, res) {
          expect(req.url).to.equal('/?foo=a&foo=b&foo=c')
          expect(req.query).to.deep.equal({ foo: ['a', 'b', 'c'] })
          res.end('success')
        }
      )

      return makeFetcher(app).fetch('/?foo=["a","b","c"]', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should unescape querystring keys', function () {
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withQueryParameters([
            new wp.model.domain.Parameter()
              .withName('foo[bar]')
              .withRequired(true)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('schema')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              )
          ])
        )

      app.get('/', ospreyMethodHandler(method, '/', 'GET'),
        function (req, res) {
          expect(req.url).to.equal('/?foo%5Bbar%5D=test')
          expect(req.query).to.deep.equal({ 'foo[bar]': 'test' })

          res.end('success')
        }
      )

      return makeFetcher(app).fetch('/?foo[bar]=test', {
        method: 'GET'
      })
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it.skip('should support unused repeat parameters (mulesoft/osprey#84)', function () {
      const app = ospreyRouter()
      const method = new wp.model.domain.Operation()
        .withMethod('GET')
        .withRequest(
          new wp.model.domain.Request().withQueryParameters([
            new wp.model.domain.Parameter()
              .withName('instance_state_name')
              .withRequired(false)
              .withSchema(
                new wp.model.domain.ScalarShape()
                  .withName('instance_state_name')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              )
          ])
        )
      /*
        queryParameters: {
          instance_state_name: {
            type: 'string',
            repeat: true,
            required: false
          }
        }
      */
      const middleware = ospreyMethodHandler(
        method, '/', 'GET', { RAMLVersion: 'RAML08' })
      app.get('/', middleware, function (req, res) {
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
        const app = ospreyRouter()
        const schema = new wp.model.domain.ScalarShape()
          .withName('schema')
          .withDataType('http://www.w3.org/2001/XMLSchema#string')
        const method = makeRequestMethod('application/json', schema)

        const middleware = ospreyMethodHandler(method, '/', 'POST')
        app.post('/', middleware, function (req, res) {
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
      function makeRamlDt () {
        return new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withMinCount(1)
              .withName('foo')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('foo')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              )
          ])
      }

      it('should reject invalid RAML datatype with standard error format', function () {
        const app = ospreyRouter()
        const method = makeRequestMethod('application/json', makeRamlDt())

        app.post('/', ospreyMethodHandler(method))

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors[0]).to.deep.equal(
            {
              type: 'json',
              keyword: 'required',
              dataPath: 'foo',
              message: 'invalid json (required, true)',
              schema: true,
              data: undefined
            }
          )
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
        const app = ospreyRouter()

        const method = makeRequestMethod(
          'application/json',
          makeRamlDt().withMinProperties(2)
        )
        app.post('/', ospreyMethodHandler(method))

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors[0]).to.deep.equal(
            {
              type: 'json',
              keyword: 'minProperties',
              dataPath: undefined,
              message: 'invalid json (minProperties, 2)',
              schema: 2,
              data: undefined
            }
          )
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
        const app = ospreyRouter()

        const method = makeRequestMethod(
          'application/json',
          makeRamlDt().withMaxProperties(1)
        )
        app.post('/', ospreyMethodHandler(method))

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors[0]).to.deep.equal(
            {
              type: 'json',
              keyword: 'maxProperties',
              dataPath: undefined,
              message: 'invalid json (maxProperties, 1)',
              schema: 1,
              data: undefined
            }
          )
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
      context('when additionalProperties is false', function () {
        it('should reject additional properties', function () {
          const app = ospreyRouter()

          const dt = makeRamlDt().withMaxProperties(1)
          dt.additionalPropertiesSchema = null
          const method = makeRequestMethod('application/json', dt)
          app.post('/', ospreyMethodHandler(method))

          app.use(function (err, req, res, next) {
            expect(err.ramlValidation).to.equal(true)
            expect(err.requestErrors[0]).to.deep.equal(
              {
                type: 'json',
                keyword: 'additionalProperties',
                dataPath: undefined,
                message: 'invalid json (additionalProperties, false)',
                schema: false,
                data: undefined
              }
            )
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
      })
      it('should accept valid RAML datatype', function () {
        const app = ospreyRouter()

        const dt = makeRamlDt()
          .withMaxProperties(1)
          .withMinProperties(1)
        dt.additionalPropertiesSchema = null
        const method = makeRequestMethod('application/json', dt)

        app.post('/', ospreyMethodHandler(method, '/', 'POST'),
          function (req, res) {
            expect(req.body).to.deep.equal({ foo: 'bar' })
            res.end('success')
          }
        )

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
        const app = ospreyRouter()

        const dt = new wp.model.domain.ArrayShape()
          .withItems(
            new wp.model.domain.ScalarShape()
              .withName('foo')
              .withDataType('http://www.w3.org/2001/XMLSchema#string')
          )
        const method = makeRequestMethod('application/json', dt)

        const middleware = ospreyMethodHandler(
          method, '/', 'POST', { RAMLVersion: 'RAML10' })
        app.post('/', middleware,
          function (req, res) {
            expect(req.body).to.deep.equal(['a', 'b', 'c'])
            res.end('success')
          }
        )

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
      context('when an array is set as root element', function () {
        it('should reject objects', function () {
          const app = ospreyRouter()

          const dt = new wp.model.domain.ArrayShape()
            .withItems(
              new wp.model.domain.ScalarShape()
                .withName('foo')
                .withDataType('http://www.w3.org/2001/XMLSchema#string')
            )
          const method = makeRequestMethod('application/json', dt)

          const middleware = ospreyMethodHandler(
            method, '/', 'POST', { RAMLVersion: 'RAML10' })
          app.post('/', middleware, function (req, res) {
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
      })
      it('should accept strings as root elements', function () {
        const app = ospreyRouter()

        const dt = new wp.model.domain.ScalarShape()
          .withName('foo')
          .withDataType('http://www.w3.org/2001/XMLSchema#string')
        const method = makeRequestMethod('application/json', dt)

        const middleware = ospreyMethodHandler(
          method, '/', 'POST', { RAMLVersion: 'RAML10' })
        app.post('/', middleware, function (req, res) {
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
      context('when a string is set as root element', function () {
        it('should reject objects', function () {
          const app = ospreyRouter()

          const dt = new wp.model.domain.ScalarShape()
            .withName('foo')
            .withDataType('http://www.w3.org/2001/XMLSchema#string')
          const method = makeRequestMethod('application/json', dt)

          const middleware = ospreyMethodHandler(
            method, '/', 'POST', { RAMLVersion: 'RAML10' })
          app.post('/', middleware, function (req, res) {
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
      })
      it('should accept objects with empty properties', function () {
        const app = ospreyRouter()

        const dt = makeRamlDt().withProperties([])
        const method = makeRequestMethod('application/json', dt)

        const middleware = ospreyMethodHandler(
          method, '/', 'POST', { RAMLVersion: 'RAML10' })
        app.post('/', middleware, function (req, res) {
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
        const app = ospreyRouter()

        const dt = makeRamlDt().withProperties([])
        const method = makeRequestMethod('application/json', dt)

        const middleware = ospreyMethodHandler(
          method, '/', 'POST', { RAMLVersion: 'RAML10' })
        app.post('/', middleware, function (req, res) {
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
          const schema = new wp.model.domain.SchemaShape().withRaw('foobar')
          const method = makeRequestMethod('text/xml', schema)
          expect(function () {
            ospreyMethodHandler(method, '/foo')
          }).to.throw(/^Unable to compile XML schema/)
        })

        it('should reject invalid xml bodies with standard error format', function () {
          const app = ospreyRouter()

          const schema = new wp.model.domain.SchemaShape().withRaw(XML_SCHEMA)
          const method = makeRequestMethod('text/xml', schema)

          app.post('/', ospreyMethodHandler(method))

          app.use(function (err, req, res, next) {
            expect(err.ramlValidation).to.equal(true)
            expect(err.requestErrors[0]).to.deep.equal(
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
            )

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
          const app = ospreyRouter()
          const schema = new wp.model.domain.SchemaShape().withRaw(XML_SCHEMA)
          const method = makeRequestMethod('text/xml', schema)

          app.post('/', ospreyMethodHandler(method))

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
          const app = ospreyRouter()
          const schema = new wp.model.domain.SchemaShape().withRaw(XML_SCHEMA)
          const method = makeRequestMethod('text/xml', schema)

          app.post('/', ospreyMethodHandler(method), function (req, res) {
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
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withName('a')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('a')
                  .withDataType('http://www.w3.org/2001/XMLSchema#boolean')
              )
          ])
        const method = makeRequestMethod('application/x-www-form-urlencoded', dt)

        const middleware = ospreyMethodHandler(method, '/', 'POST', { RAMLVersion: 'RAML10' })
        app.post('/', middleware)

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors[0]).to.deep.equal(
            {
              type: 'form',
              keyword: 'type',
              dataPath: 'a',
              message: 'invalid form (type, boolean)',
              schema: 'boolean',
              data: ['true', '123']
            }
          )

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

      it.skip('should parse valid forms (RAML 0.8)', function () {
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withName('a')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('a')
                  .withDataType('http://www.w3.org/2001/XMLSchema#boolean')
              )
          ])
        const method = makeRequestMethod('application/x-www-form-urlencoded', dt)
        /*
        'application/x-www-form-urlencoded': {
          formParameters: {
            a: {
              type: 'boolean',
              repeat: true
            }
          }
        */
        const middleware = ospreyMethodHandler(
          method, '/', 'POST', { RAMLVersion: 'RAML08' })
        app.post('/', middleware, function (req, res) {
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
        const app = ospreyRouter()

        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.ArrayShape()
              .withName('a')
              .withItems(
                new wp.model.domain.ScalarShape()
                  .withName('a')
                  .withDataType('http://www.w3.org/2001/XMLSchema#boolean')
              )
          ])
        const method = makeRequestMethod('application/x-www-form-urlencoded', dt)

        const middleware = ospreyMethodHandler(
          method, '/', 'POST', { RAMLVersion: 'RAML10' })
        app.post('/', middleware, function (req, res) {
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
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withName('username')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('username')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
                  .withPattern('^[a-zA-Z]\\w*$')
              )
          ])
        const method = makeRequestMethod('multipart/form-data', dt)

        app.post('/', ospreyMethodHandler(method), function (req, res, next) {
          req.form.on('error', next)

          req.pipe(req.form)
        })

        app.use(function (err, req, res, next) {
          expect(err.ramlValidation).to.equal(true)
          expect(err.requestErrors[0]).to.deep.equal(
            {
              type: 'form',
              keyword: 'pattern',
              dataPath: 'username',
              message: 'invalid form (pattern, ^[a-zA-Z]\\w*$)',
              schema: '^[a-zA-Z]\\w*$',
              data: '123'
            }
          )

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
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withName('username')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('username')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
                  .withPattern('[a-zA-Z]\\w*')
              )
          ])
        const method = makeRequestMethod('multipart/form-data', dt)

        app.post('/', ospreyMethodHandler(method), function (req, res) {
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
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withName('number')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('number')
                  .withDataType('http://www.w3.org/2001/XMLSchema#number')
              )
          ])
        const method = makeRequestMethod('multipart/form-data', dt)

        app.post('/', ospreyMethodHandler(method), function (req, res) {
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
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withName('item')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('item')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              )
          ])
        const method = makeRequestMethod('multipart/form-data', dt)

        app.post('/', ospreyMethodHandler(method), function (req, res, next) {
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
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withMinCount(1)
              .withName('item')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('item')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              ),
            new wp.model.domain.PropertyShape()
              .withMinCount(0)
              .withName('more')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('mode')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              )
          ])
        const method = makeRequestMethod('multipart/form-data', dt)

        app.post('/', ospreyMethodHandler(method), function (req, res, next) {
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
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withName('contents')
              .withRange(
                new wp.model.domain.FileShape()
                  .withName('contents')
                  .withFileTypes(['*/*'])
              ),
            new wp.model.domain.PropertyShape()
              .withMinCount(0)
              .withName('filename')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('filename')
                  .withDataType('http://www.w3.org/2001/XMLSchema#string')
              )
          ])
        const method = makeRequestMethod('multipart/form-data', dt)

        app.post('/', ospreyMethodHandler(method), function (req, res) {
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

      it.skip('should ignore unknown files and fields (RAML 0.8)', function () {
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withName('file')
              .withRange(
                new wp.model.domain.FileShape().withName('file')
              )
          ])
        const method = makeRequestMethod('multipart/form-data', dt)

        const middleware = ospreyMethodHandler(
          method, '/', 'POST', { RAMLVersion: 'RAML08' })
        app.post('/', middleware, function (req, res) {
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
        const app = ospreyRouter()
        const dt = new wp.model.domain.NodeShape()
          .withName('schema')
          .withProperties([
            new wp.model.domain.PropertyShape()
              .withName('items')
              .withRange(
                new wp.model.domain.ScalarShape()
                  .withName('items')
                  .withDataType('http://www.w3.org/2001/XMLSchema#boolean')
              )
          ])
        const method = makeRequestMethod('application/json', dt)

        app.post('/', ospreyMethodHandler(method))

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
      context('when defined', function () {
        it('should pass unknown bodies through', function () {
          const app = ospreyRouter()

          const dt = new wp.model.domain.NilShape()
          const method = makeRequestMethod('text/html', dt)

          app.post('/', ospreyMethodHandler(method), function (req, res) {
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
    })

    describe('multiple', function () {
      it.skip('should parse as the correct content type', function () {
        const app = ospreyRouter()
        const method = new wp.model.domain.Operation()
          .withMethod('GET')
          .withRequest(
            new wp.model.domain.Request().withPayloads([
              new wp.model.domain.Payload()
                .withMediaType('application/json')
                .withSchema(
                  new wp.model.domain.NodeShape()
                    .withName('schema')
                    .withProperties([
                      new wp.model.domain.PropertyShape()
                        .withMinCount(1)
                        .withName('items')
                        .withRange(
                          new wp.model.domain.ScalarShape()
                            .withName('items')
                            .withDataType('http://www.w3.org/2001/XMLSchema#string')
                        )
                    ])
                ),
              new wp.model.domain.Payload()
                .withMediaType('multipart/form-data')
                .withSchema(
                  new wp.model.domain.NodeShape()
                    .withName('schema')
                    .withProperties([
                      new wp.model.domain.PropertyShape()
                        .withMinCount(1)
                        .withName('items')
                        .withRange(
                          new wp.model.domain.ScalarShape()
                            .withName('items')
                            .withDataType('http://www.w3.org/2001/XMLSchema#boolean')
                        )
                      // repeat: true
                    ])
                )
            ])
          )

        const middleware = ospreyMethodHandler(
          method, '/', 'POST', { RAMLVersion: 'RAML08' })
        app.post('/', middleware, function (req, res) {
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
        const app = ospreyRouter()

        const middleware = ospreyMethodHandler(new wp.model.domain.Operation())
        app.post('/', middleware, function (req, res) {
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
      const app = ospreyRouter()

      const middleware = ospreyMethodHandler(
        null, '/', 'POST', { discardUnknownBodies: false })
      app.post(
        '/',
        middleware,
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
      const app = ospreyRouter()
      const dt = new wp.model.domain.NilShape()
      const method = makeRequestMethod('*/*', dt)

      const middleware = ospreyMethodHandler(method, '/', 'POST')
      app.post('/', middleware, function (req, res, next) {
        req.pipe(res)
      })
      const form = new FormData()
      form.append('foobar', 'hello world')

      return makeFetcher(app).fetch('/', {
        body: form,
        headers: form.getHeaders(),
        method: 'POST'
      })
        .then(function (res) {
          expect(res.body).to.contain('hello world')
          expect(typeof res.body).to.equal('string')
          expect(res.status).to.equal(200)
        })
    })
  })

  describe('accept', function () {
    function makeResponseMethod (ct, schema, code) {
      return new wp.model.domain.Operation()
        .withMethod('GET')
        .withResponses([
          new wp.model.domain.Response()
            .withStatusCode(code)
            .withPayloads([
              new wp.model.domain.Payload()
                .withMediaType(ct)
                .withSchema(schema)
            ])
        ])
    }

    it('should reject requests with invalid accept headers', function () {
      const app = ospreyRouter()
      const dt = new wp.model.domain.NilShape()
      const method = makeResponseMethod('text/html', dt, 200)

      app.get('/', ospreyMethodHandler(method))

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
      const app = ospreyRouter()
      const dt = new wp.model.domain.NilShape()
      const method = makeResponseMethod('text/html', dt, 200)

      app.get('/', ospreyMethodHandler(method), function (req, res) {
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
      const app = ospreyRouter()
      const dt = new wp.model.domain.NodeShape()
      const method = makeResponseMethod('text/html', dt, 200)
      method.responses[0].withPayloads([])
      app.get('/', ospreyMethodHandler(method), function (req, res) {
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
