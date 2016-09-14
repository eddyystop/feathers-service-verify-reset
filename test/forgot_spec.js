
/* global assert, describe, it */
/* eslint  no-shadow: 0, no-var: 0, one-var: 0, one-var-declaration-per-line: 0,
no-param-reassign: 0, no-unused-vars: 0  */

const assert = require('chai').assert;
const feathersStubs = require('./../test/helpers/feathersStubs');
const verifyResetService = require('../lib/index').service;
const SpyOn = require('./helpers/basicSpy');

const defaultResetDelay = 1000 * 60 * 60 * 2; // 2 hours

// user DB

const now = Date.now();
const usersDb = [
  { _id: 'a', email: 'a', isVerified: false, verifyToken: '000', verifyExpires: now + 50000 },
  { _id: 'b', email: 'b', isVerified: true, verifyToken: null, verifyExpires: null },
];

// Tests
['_id', 'id'].forEach(idType => {
  ['paginated', 'non-paginated'].forEach(pagination => {
    const ifNonPaginated = pagination === 'non-paginated';

    describe(`verifyReset::forgot ${pagination} ${idType}`, () => {
      var db;
      var app;
      var users;
      var verifyReset;

      beforeEach(() => {
        db = clone(usersDb);
        app = feathersStubs.app();
        users = feathersStubs.users(app, db, ifNonPaginated, idType);
        verifyResetService().call(app); // define and attach verifyReset service
        verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset
      });

      it('updates verified user', (done) => {
        const email = 'b';
        verifyReset.create({ action: 'forgot', value: email }, {}, (err, user) => {
          assert.strictEqual(err, null, 'err code set');
          assert.strictEqual(user.isVerified, true, 'isVerified not true');
          assert.isString(user.resetToken, 'resetToken not String');
          assert.equal(user.resetToken.length, 30, 'reset token wrong length');
          aboutEqualDateTime(user.resetExpires, makeDateTime());

          done();
        });
      });

      it('error on unverified user', (done) => {
        const email = 'a';
        verifyReset.create({ action: 'forgot', value: email }, {}, (err, user) => {
          assert.equal(err.message, 'Email is not yet verified.');
          assert.deepEqual(err.errors, { email: 'Not verified.' });
          done();
        });
      });

      it('error on email not found', (done) => {
        const email = 'x';
        verifyReset.create({ action: 'forgot', value: email }, {}, (err, user) => {
          assert.equal(err.message, 'Email not found.');
          assert.deepEqual(err.errors, { email: 'Not found.' });

          done();
        });
      });
    });

    describe(`verifyReset::forgot with email ${pagination} ${idType}`, () => {
      var db;
      var app;
      var users;
      var spyEmailer;
      var verifyReset;

      beforeEach(() => {
        db = clone(usersDb);
        app = feathersStubs.app();
        users = feathersStubs.users(app, db, ifNonPaginated, idType);
        spyEmailer = new SpyOn(emailer);

        verifyResetService({ emailer: spyEmailer.callWithCb }).call(app); // attach verifyReset
        verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset
      });

      it('updates verified user', (done) => {
        const email = 'b';
        verifyReset.create({ action: 'forgot', value: email }, {}, (err, user) => {
          assert.strictEqual(err, null, 'err code set');
          assert.strictEqual(user.isVerified, true, 'isVerified not true');
          assert.isString(user.resetToken, 'resetToken not String');
          assert.equal(user.resetToken.length, 30, 'reset token wrong length');
          aboutEqualDateTime(user.resetExpires, makeDateTime());

          assert.deepEqual(spyEmailer.result(), [
            { args: ['forgot', user, {}], result: [null] },
          ]);

          done();
        });
      });
    });
  });
});

// Helpers

function emailer(action, user, params, cb) {
  cb(null);
}

function makeDateTime(options1) {
  options1 = options1 || {};
  return Date.now() + (options1.delay || defaultResetDelay);
}

function aboutEqualDateTime(time1, time2, msg, delta) {
  delta = delta || 500;
  const diff = Math.abs(time1 - time2);
  assert.isAtMost(diff, delta, msg || `times differ by ${diff}ms`);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
