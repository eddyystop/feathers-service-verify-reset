
/* global assert, describe, it */
/* eslint  no-shadow: 0, no-unused-vars: 0, no-var: 0, one-var: 0,
one-var-declaration-per-line: 0 */

const assert = require('chai').assert;
const feathersStubs = require('./helpers/feathersStubs');
const verifyResetService = require('../lib').service;
const SpyOn = require('./helpers/basicSpy');

// user DB

const now = Date.now();
const usersDb = [
  { _id: 'a', email: 'a', isVerified: false, verifyToken: '000', verifyExpires: now + 50000 },
  { _id: 'b', email: 'b', isVerified: true, verifyToken: null, verifyExpires: null },
  { _id: 'c', email: 'c', isVerified: false, verifyToken: '111', verifyExpires: now - 50000 },
];

// Tests

describe('verify', () => {
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

describe('verify with email', () => {
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

    verifyResetService({ emailer: spyEmailer.callWithCb }).call(app); // attach verifyReset service
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
        { args: ['verify', user, {}], result: [null] },
      ]);

      done();
    });
  });
});

// Helpers

function emailer(action, user, params, cb) {
  cb(null);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
