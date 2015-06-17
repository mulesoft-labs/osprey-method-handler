# Change Log

All notable changes to this project will be documented in this file. This project adheres to [Semantic Versioning](http://semver.org/).

## [0.2.2](https://github.com/blakeembrey/atom-dash/compare/v0.2.1...v0.2.2) - 2015-06-17

### Added

- This change log.

### Fixed

- Catch and error on invalid XML bodies.

### Changed

- Warn user when application is using `libxml` and it's not installed.
- Improved error messages for invalid RAML schemas.
- Better error messages for invalid accept and content type headers.

### Removed

- Unused JSHint files.

## [0.2.1](https://github.com/blakeembrey/atom-dash/compare/v0.2.0...v0.2.1) - 2015-06-11

### Fixed

- Unable to subclass `http-errors`, create and decorate instead.

## [0.2.0](https://github.com/blakeembrey/atom-dash/compare/v0.1.2...v0.2.0) - 2015-05-15

### Added

- Add resource path to handler.

### Changed

- Update Osprey router.
- Update Popsicle development dependencies.

## [0.1.2](https://github.com/blakeembrey/atom-dash/compare/v0.1.1...v0.1.2) - 2015-05-04

### Changed

- Update to latest Osprey router changes.

## [0.1.1](https://github.com/blakeembrey/atom-dash/compare/v0.1.0...v0.1.1) - 2015-04-18

### Changed

- Make `libxmljs` an optional dependency.

## [0.1.0](https://github.com/blakeembrey/atom-dash/compare/v0.0.7...v0.1.0) - 2015-04-16

### Changed

- Refactor module to use standard formatting.
- Use standard request headers, instead of just all headers as request.

## [0.0.7](https://github.com/blakeembrey/atom-dash/compare/v0.0.6...v0.0.7) - 2015-03-06

### Added

- Make sure JSON schemas are v4 compatible.

### Changed

- Allow empty `schema` and/or `formParameters` from RAML.

## [0.0.6](https://github.com/blakeembrey/atom-dash/compare/v0.0.5...v0.0.6) - 2015-02-05

### Added

- Negotiate HTTP accept headers using the RAML values.
- Add a features list to README.

## [0.0.5](https://github.com/blakeembrey/atom-dash/compare/v0.0.4...v0.0.5) - 2015-02-05

### Changed

- Update `raml-validate` to handle array validation through RAML.

## [0.0.4](https://github.com/blakeembrey/atom-dash/compare/v0.0.3...v0.0.4) - 2015-02-05

### Changed

- Provide validation errors array with error instance for potential formatting by the user.

## [0.0.3](https://github.com/blakeembrey/atom-dash/compare/v0.0.2...v0.0.3) - 2015-02-02

### Changed

- Update Osprey router to `0.0.4`.
- Name middleware functions for better stack traces.

## [0.0.2](https://github.com/blakeembrey/atom-dash/compare/v0.0.1...v0.0.2) - 2015-01-29

### Added

- `package.json` description.

### Removed

- Unused development dependencies.
- Remove discarding empty RAML request bodies.

### Fixed

- README example using Express.

### Changed

- Updated Osprey router version to `0.0.3`.

## 0.0.1 - 2015-01-28

### Added

- Initial RAML method handler release.
