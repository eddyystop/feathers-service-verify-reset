
/* global assert, describe, it */
/* eslint  no-shadow: 0, no-var: 0, one-var: 0, one-var-declaration-per-line: 0 */

const assert = require('chai').assert;
const debug = require('debug')('test:verify_spec');
const feathersStubs = require('./helpers/feathersStubs');
const verifyResetService = require('../src').service;

const SpyOn = feathersStubs.SpyOn;
const defaultVerifyDelay = 1000 * 60 * 60 * 24 * 5; // 5 days
const defaultResetDelay = 1000 * 60 * 60 * 2; // 2 hours

// user DB

const now = Date.now();
const usersDb = [
  { _id: 'a', email: 'a', isVerified: false, verifyToken: '000', verifyExpires: now + 50000 },
  { _id: 'b', email: 'b', isVerified: true, verifyToken: null, verifyExpires: null },
  { _id: 'c', email: 'c', isVerified: false, verifyToken: '111', verifyExpires: now - 50000 },
];

// Tests

describe('verifyReset::verify', () => {
  var db;
  var app;
  var users;
  var verifyReset;

  beforeEach(() => {
    db = clone(usersDb);
    app = feathersStubs.app();
    users = feathersStubs.users(app, db);
    verifyResetService().call(app); // define and attach verifyReset service
    verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset service
  });

  it('verifies valid token', (done) => {
    const verifyToken = '000';

    verifyReset.create({ action: 'verify', value: verifyToken }, {}, (err, user) => {

      assert.strictEqual(err, null, 'err code set');
      assert.strictEqual(user.isVerified, true, 'isVerified not true');
      assert.strictEqual(user.verifyToken, null, 'verifyToken not null');
      assert.strictEqual(user.verifyExpires, null, 'verifyExpires not null');

      done();
    });
  });

  it('error on expired token', (done) => {
    const verifyToken = '111';
    verifyReset.create({ action: 'verify', value: verifyToken }, {}, (err, user) => {

      assert.equal(err.message, 'Verification token has expired.');

      done();
    });
  });

  it('error on null token', (done) => {
    const verifyToken = null;
    verifyReset.create({ action: 'verify', value: verifyToken }, {}, (err, user) => {

      assert.equal(err.message, 'User is already verified.');

      done();
    });
  });

  it('error on token not found', (done) => {
    const verifyToken = '999';
    verifyReset.create({ action: 'verify', value: verifyToken }, {}, (err, user) => {

      assert.equal(err.message, 'Verification token not found.');

      done();
    });
  });
});

describe('verifyReset::verify with email', () => {
  var db;
  var app;
  var users;
  var spyEmailer;
  var verifyReset;

  beforeEach(() => {
    db = clone(usersDb);
    app = feathersStubs.app();
    users = feathersStubs.users(app, usersDb);
    spyEmailer = new SpyOn(emailer);

    verifyResetService({ emailer: spyEmailer.callWithCb }).call(app); // define and attach verifyReset service
    verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset service
  });

  it('verifies valid token', (done) => {
    const verifyToken = '000';

    verifyReset.create({ action: 'verify', value: verifyToken }, {}, (err, user) => {

      assert.strictEqual(err, null, 'err code set');
      assert.strictEqual(user.isVerified, true, 'isVerified not true');
      assert.strictEqual(user.verifyToken, null, 'verifyToken not null');
      assert.strictEqual(user.verifyExpires, null, 'verifyExpires not null');

      assert.deepEqual(spyEmailer.result(), [
        { args: ['verify', user, {}], result: [null] }
      ]);

      done();
    });
  });
});

// Helpers

function emailer(action, user, params, cb) {
  cb(null);
}

function makeDateTime(options1) {
  options1 = options1 || {};
  return Date.now() + (options1.delay || defaultVerifyDelay);
}

function aboutEqualDateTime(time1, time2, msg, delta) {
  delta = delta || 500;
  const diff = Math.abs(time1 - time2);
  assert.isAtMost(diff, delta, msg || `times differ by ${diff}ms`)
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
