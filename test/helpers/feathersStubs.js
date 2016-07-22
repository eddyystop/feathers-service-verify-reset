
const sift = require('sift');
const debug = require('debug')('test:feathersStubs');

/**
 * Return a stub for feathers' app
 * @param {Object} config to server .app.get(prop) requests
 * @returns {Object} feathers' app with .use and .service
 */

module.exports.app = function app(config) {
  return {
    services: {},
    use(route, serviceObject) {
      this.services[route] = serviceObject;
    },
    service(route) {
      if (!(route in this.services)) {
        throw new Error(`Service for route '${route} not found.`);
      }

      return this.services[route];
    },
    get(str) {
      return (config || {})[str];
    }
  };
};

/**
 * Return a stub for feathers' users service
 * @param {Object} app stub
 * @param {Array.Object} usersDb is the database of users
 * @returns {Object} feather' service for route /users
 */

module.exports.users = function users(app, usersDb) {
  const usersConfig = {
    find(params) { // always use as a Promise
      const data = sift(params.query || {}, usersDb);
      debug('/users find: %d %o', data.length, params);

      return new Promise((resolve) => {
        resolve({
          total: data.length,
          data,
        });
      });
    },
    update(id, user, params, cb) { // always use with a callback
      debug('/users update: %s %o %o', id, user, params);
      const index = usersDb.findIndex((user => user._id === id));

      if (index === -1) {
        return cb(new Error(`users.update _id=${id} not found.`));
      }

      usersDb[index] = user;
      cb(null, user); // we're skipping before & after hooks
    },
  };

  app.use('/users', usersConfig);

  return app.service('/users');
};

/**
 * Create a light weight spy on functions.
 *
 * @param {Function} fcn to spy on
 * @returns {Object} spy. Call fcn with spy.callWith(...). Get params and results with spy.result().
 * @constructor
 *
 * (1) To test a function without a callback:
 *
 * function test(a, b, c) { return ['y', false, [a, b, c]]; }
 * const spyTest = new feathersStub.SpyOn(test);
 * spyTest.callWith(1, 2, 3);
 * spyTest.callWith(4, 5, 6);
 *
 * spyTest.result();
 * // [ { args: [1, 2, 3], result: ['y', false, [1, 2, 3]] },
 * //   { args: [4, 5, 6], result: ['y', false, [4, 5, 6]] } ]
 *
 * (2) To test a function with a callback as the last param:
 *
 * function testCb(a, b, c, cb) { setTimeout(() => {  return cb('a', true, [a, b, c]); }, 0); }
 * const spyTestCb = new SpyOn(testCb);
 * spyTestCb.callWithCb(1, 2, 3, (x, y, z) => {
 *   spyTestCb.callWithCb(8, 9, 0, (x, y, z) => {
 *
 *     spyTestCb.result()
 *     // [ { args: [1, 2, 3], result: ['a', true, [1, 2, 3]] },
 *     //   { args: [8, 9, 0], result: ['a', true, [8, 9, 0]] } ]
 *   });
 * });
 */

function SpyOn(fcn) {
  if(!(this instanceof SpyOn)) { return new SpyOn(fcn); }
  const stack = [];

  // spy on function without a callback
  // not being part of prototype chain allows callers to set 'this'

  this.callWith = function () {
    const args = Array.prototype.slice.call(arguments);

    const myStackOffset = stack.length;
    stack.push({ args });
    const result = fcn.apply(this, args);
    stack[myStackOffset].result = result; // can handle recursion

    return result;
  };

  // spy on function with a callback
  // not being part of prototype chain allows callers to set 'this'

  this.callWithCb = function () {
    const args = Array.prototype.slice.call(arguments);

    const myStackOffset = stack.length;
    stack.push({ args: args.slice(0, -1) });

    args[args.length - 1] = cbWrapper(args[args.length - 1]);
    fcn.apply(this, args);

    function cbWrapper(fcnCb) {
      return function cbWrapperInner() {
        const args = Array.prototype.slice.call(arguments);

        stack[myStackOffset].result = args;

        fcnCb.apply(this, args);
      }
    }
  };

  // return spy info

  this.result = function () {
    return stack;
  };
}

module.exports.SpyOn = SpyOn;

// Helpers

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
