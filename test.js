/* global describe, it */

require('es6-promise').polyfill()

var expect = require('chai').expect
var popsicle = require('popsicle')
var server = require('popsicle-server')
var router = require('osprey-router')
var finalhandler = require('finalhandler')
var fs = require('fs')
var join = require('path').join
var streamEqual = require('stream-equal')
var handler = require('./')

describe('osprey method handler', function () {
  it('should return a middleware function', function () {
    var middleware = handler()

    expect(middleware).to.be.a('function')
    expect(middleware.length).to.equal(3)
  })

  describe('headers', function () {
    it('should reject invalid headers', function () {
      var app = router()

      app.get('/', handler({
        headers: {
          'X-Header': {
            type: 'integer'
          }
        }
      }))

      return popsicle({
        url: '/',
        headers: {
          'X-Header': 'abc'
        }
      })
        .use(server(createServer(app)))
        .then(function (res) {
          expect(res.status).to.equal(400)
        })
    })

    it('should sanitize headers', function () {
      var app = router()

      app.get('/', handler({
        headers: {
          date: {
            type: 'date'
          }
        }
      }), function (req, res) {
        expect(req.headers.date).to.be.an.instanceOf(Date)

        res.end('success')
      })

      return popsicle({
        url: '/',
        headers: {
          date: new Date().toString()
        }
      })
        .use(server(createServer(app)))
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })
  })

  describe('query parameters', function () {
    it('should reject invalid query parameters', function () {
      var app = router()

      app.get('/', handler({
        queryParameters: {
          a: {
            type: 'string'
          },
          b: {
            type: 'integer'
          }
        }
      }))

      return popsicle('/?a=value&b=value')
        .use(server(createServer(app)))
        .then(function (res) {
          expect(res.status).to.equal(400)
        })
    })

    it('should filter undefined query parameters', function () {
      var app = router()

      app.get('/', handler({
        queryParameters: {
          a: {
            type: 'string'
          }
        }
      }), function (req, res) {
        expect(req.url).to.equal('/?a=value')
        expect(req.query).to.deep.equal({ a: 'value' })

        res.end('success')
      })

      return popsicle('/?a=value&b=value')
        .use(server(createServer(app)))
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should remove all unknown query parameters', function () {
      var app = router()

      app.get('/', handler({
        queryParameters: {
          q: {
            type: 'string'
          }
        }
      }), function (req, res) {
        expect(req.url).to.equal('/')
        expect(req.query).to.deep.equal({})

        res.end('success')
      })

      return popsicle('/?a=value&b=value')
        .use(server(createServer(app)))
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })

    it('should support empty query strings', function () {
      var app = router()

      app.get('/', handler(), function (req, res) {
        expect(req.url).to.equal('/')
        expect(req.query).to.deep.equal({})

        res.end('success')
      })

      return popsicle('/')
        .use(server(createServer(app)))
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })
  })

  describe('body', function () {
    describe('json', function () {
      var JSON_SCHEMA = '{"items":{"type":"boolean"}}'

      it('should error creating middleware with invalid json', function () {
        expect(function () {
          handler({
            body: {
              'application/json': {
                schema: 'foobar'
              }
            }
          }, '/foo')
        }).to.throw(/^Unable to parse JSON schema/)
      })

      it('should reject invalid json', function () {
        var app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: JSON_SCHEMA
            }
          }
        }))

        return popsicle({
          url: '/',
          method: 'post',
          body: [true, 123]
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should reject invalid request bodies', function () {
        var app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: JSON_SCHEMA
            }
          }
        }))

        return popsicle({
          url: '/',
          method: 'post',
          body: 'foobar',
          headers: {
            'Content-Type': 'application/json'
          }
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should parse valid json', function () {
        var app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: JSON_SCHEMA
            }
          }
        }), function (req, res) {
          expect(req.body).to.deep.equal([true, false])

          res.end('success')
        })

        return popsicle({
          url: '/',
          method: 'post',
          body: [true, false]
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('xml', function () {
      var XML_SCHEMA = [
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
        }).to.throw(/^Unable to parse XML schema/)
      })

      it('should reject invalid xml bodies', function () {
        var app = router()

        app.post('/', handler({
          body: {
            'text/xml': {
              schema: XML_SCHEMA
            }
          }
        }))

        return popsicle({
          url: '/',
          method: 'post',
          body: '<?xml version="1.0"?><comment>A comment</comment>',
          headers: {
            'Content-Type': 'text/xml'
          }
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should reject invalid request bodies', function () {
        var app = router()

        app.post('/', handler({
          body: {
            'text/xml': {
              schema: XML_SCHEMA
            }
          }
        }))

        return popsicle({
          url: '/',
          method: 'post',
          body: 'foobar',
          headers: {
            'Content-Type': 'text/xml'
          }
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should parse valid xml documents', function () {
        var app = router()

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

        return popsicle({
          url: '/',
          method: 'post',
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
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('urlencoded', function () {
      it('should reject invalid forms', function () {
        var app = router()

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
        }))

        return popsicle({
          url: '/',
          method: 'post',
          body: 'a=true&a=123',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should parse valid forms', function () {
        var app = router()

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
        }), function (req, res) {
          expect(req.body).to.deep.equal({ a: [true, true] })

          res.end('success')
        })

        return popsicle({
          url: '/',
          method: 'post',
          body: 'a=true&a=123',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('form data', function () {
      it('should reject invalid forms', function () {
        var app = router()

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
        }), function (req, res, next) {
          req.form.on('error', function (err) {
            return next(err)
          })

          req.pipe(req.form)
        })

        return popsicle({
          url: '/',
          method: 'post',
          body: popsicle.form({
            username: '123'
          })
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should parse valid forms', function () {
        var app = router()

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

        return popsicle({
          url: '/',
          method: 'post',
          body: popsicle.form({
            username: 'blakeembrey'
          })
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })

      it('should properly sanitize form values', function () {
        var app = router()

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

        return popsicle({
          url: '/',
          method: 'post',
          body: popsicle.form({
            number: '12345'
          })
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })

      it('should error with repeated values', function () {
        var app = router()

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

        var form = popsicle.form()

        form.append('item', 'abc')
        form.append('item', '123')

        return popsicle({
          url: '/',
          method: 'post',
          body: form
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should error if it did not receive all required values', function () {
        var app = router()

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

        var form = popsicle.form()

        form.append('more', '123')

        return popsicle({
          url: '/',
          method: 'post',
          body: form
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.status).to.equal(400)
          })
      })

      it('should allow files', function () {
        var app = router()

        app.post('/', handler({
          body: {
            'multipart/form-data': {
              formParameters: {
                contents: {
                  type: 'file'
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
              fs.createReadStream(join(__dirname, 'LICENSE')),
              function (err, equal) {
                expect(equal).to.be.true

                return err ? res.end() : res.end('success')
              }
            )
          })

          req.pipe(req.form)
        })

        return popsicle({
          url: '/',
          method: 'post',
          body: popsicle.form({
            contents: fs.createReadStream(join(__dirname, 'LICENSE')),
            filename: 'LICENSE'
          })
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })

      it('should ignore unknown files and fields', function () {
        var app = router()

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
        }), function (req, res) {
          var callCount = 0

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

        return popsicle({
          url: '/',
          method: 'post',
          body: popsicle.form({
            file: fs.createReadStream(join(__dirname, 'LICENSE')),
            another: fs.createReadStream(join(__dirname, 'README.md')),
            random: 'hello world'
          })
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('unknown', function () {
      it('should reject unknown request types', function () {
        var app = router()

        app.post('/', handler({
          body: {
            'application/json': {
              schema: '{"items":{"type":"boolean"}}'
            }
          }
        }))

        return popsicle({
          url: '/',
          method: 'post',
          body: 'test',
          headers: {
            'Content-Type': 'text/html'
          }
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.status).to.equal(415)
          })
      })

      it('should pass unknown bodies through when defined', function () {
        var app = router()

        app.post('/', handler({
          body: {
            'text/html': null
          }
        }), function (req, res) {
          res.end('success')
        })

        return popsicle({
          url: '/',
          method: 'post',
          body: 'test',
          headers: {
            'Content-Type': 'text/html'
          }
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('multiple', function () {
      it('should parse as the correct content type', function () {
        var app = router()

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
        }), function (req, res) {
          var callCount = 0

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

        var form = popsicle.form()

        form.append('items', 'true')
        form.append('items', 'false')

        return popsicle({
          url: '/',
          method: 'post',
          body: form
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal('success')
            expect(res.status).to.equal(200)
          })
      })
    })

    describe('empty', function () {
      it('should discard empty request bodies', function () {
        var app = router()

        app.post('/', handler({}), function (req, res) {
          return req._readableState.ended ? res.end() : req.pipe(res)
        })

        return popsicle({
          url: '/',
          body: popsicle.form({
            file: fs.createReadStream(join(__dirname, 'test.js'))
          }),
          method: 'post'
        })
          .use(server(createServer(app)))
          .then(function (res) {
            expect(res.body).to.equal(null)
            expect(res.status).to.equal(200)
          })
      })
    })
  })

  describe('wildcard', function () {
    it('should accept any body', function () {
      var app = router()

      app.post('/', handler({
        body: {
          '*/*': null
        }
      }, '/'), function (req, res) {
        return req.pipe(res)
      })

      return popsicle({
        url: '/',
        body: popsicle.form({
          file: fs.createReadStream(join(__dirname, 'test.js'))
        }),
        method: 'post'
      })
        .use(server(createServer(app)))
        .then(function (res) {
          expect(res.body).to.be.a.string
          expect(res.status).to.equal(200)
        })
    })
  })

  describe('accept', function () {
    it('should reject requests with invalid accept headers', function () {
      var app = router()

      app.get('/', handler({
        responses: {
          '200': {
            body: {
              'text/html': null
            }
          }
        }
      }))

      return popsicle({
        url: '/',
        headers: {
          'Accept': 'application/json'
        }
      })
        .use(server(createServer(app)))
        .then(function (res) {
          expect(res.status).to.equal(406)
        })
    })

    it('should accept requests with valid accept headers', function () {
      var app = router()

      app.get('/', handler({
        responses: {
          '200': {
            body: {
              'text/html': null
            }
          }
        }
      }), function (req, res) {
        expect(req.headers.accept).to.equal('application/json, text/html')

        res.end('success')
      })

      return popsicle({
        url: '/',
        headers: {
          'Accept': 'application/json, text/html'
        }
      })
        .use(server(createServer(app)))
        .then(function (res) {
          expect(res.body).to.equal('success')
          expect(res.status).to.equal(200)
        })
    })
  })
})

function createServer (router) {
  return function (req, res) {
    router(req, res, finalhandler(req, res))
  }
}
