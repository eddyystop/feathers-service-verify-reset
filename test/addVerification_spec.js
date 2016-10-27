
/* global assert, describe, it */
/* eslint no-param-reassign: 0, no-shadow: 0, no-var: 0, one-var: 0,
one-var-declaration-per-line: 0 */

const assert = require('chai').assert;
const hooks = require('../lib').hooks;

const defaultVerifyDelay = 1000 * 60 * 60 * 24 * 5; // 5 days

var hookIn;
var options;

describe('hook:addVerification', () => {
  beforeEach(() => {
    hookIn = {
      type: 'before',
      method: 'create',
      data: { email: 'a@a.com', password: '0000000000' },
    };
    options = {};
  });

  it('works with no options', (done) => {
    hooks.addVerification()(hookIn)
      .then(hook => {
        const user = hook.data;

        assert.strictEqual(user.isVerified, false, 'isVerified not false');
        assert.isString(user.verifyToken, 'verifyToken not String');
        assert.equal(user.verifyToken.length, 30, 'verify token wrong length');
        aboutEqualDateTime(user.verifyExpires, makeDateTime());

        done();
      })
      .catch(err => {
        assert.fail(true, false, 'unexpected error');

        done();
      });
  });

  it('delay option works', (done) => {
    options = { delay: 1000 * 60 * 60 * 24 * 15 }; // 5 days}

    hooks.addVerification(options)(hookIn)
      .then(hook => {
        const user = hook.data;

        assert.strictEqual(user.isVerified, false, 'isVerified not false');
        assert.isString(user.verifyToken, 'verifyToken not String');
        assert.equal(user.verifyToken.length, 30, 'verify token wrong length');
        aboutEqualDateTime(user.verifyExpires, makeDateTime(options));

        done();
      })
      .catch(err => {
        assert.fail(true, false, 'unexpected error');

        done();
      });
  });

  it('length option works', (done) => {
    options = { len: 10 };
    hooks.addVerification(options)(hookIn)
      .then(hook => {
        const user = hook.data;

        assert.strictEqual(user.isVerified, false, 'isVerified not false');
        assert.isString(user.verifyToken, 'verifyToken not String');
        assert.equal(user.verifyToken.length, options.len * 2, 'verify token wrong length');
        aboutEqualDateTime(user.verifyExpires, makeDateTime(options));

        done();
      })
      .catch(err => {
        assert.fail(true, false, 'unexpected error');

        done();
      });
  });

  it('throws if not before', () => {
    hookIn.type = 'after';

    assert.throws(() => { hooks.restrictToVerified()(hookIn); });
  });

  it('throws if not create', () => {
    hookIn.method = 'update';

    assert.throws(() => { hooks.restrictToVerified()(hookIn); });
  });
});

function makeDateTime(options1) {
  options1 = options1 || {};
  return Date.now() + (options1.delay || defaultVerifyDelay);
}

function aboutEqualDateTime(time1, time2, msg, delta) {
  delta = delta || 500;
  const diff = Math.abs(time1 - time2);
  assert.isAtMost(diff, delta, msg || `times differ by ${diff}ms`);
}
