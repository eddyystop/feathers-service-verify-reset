
/* global assert, describe, it */
/* eslint  no-shadow: 0, no-var: 0, one-var: 0, one-var-declaration-per-line: 0,
no-unused-vars: 0 */

const assert = require('chai').assert;
const feathersStubs = require('./../test/helpers/feathersStubs');
const verifyResetService = require('../lib/index').service;
const SpyOn = require('./helpers/basicSpy');

// user DB

const now = Date.now();
const usersDb = [
  { _id: 'a', email: 'a', isVerified: true, resetToken: '000', resetExpires: now + 50000 },
  { _id: 'b', email: 'b', isVerified: true, resetToken: null, resetExpires: null },
  { _id: 'c', email: 'c', isVerified: true, resetToken: '111', resetExpires: now - 50000 },
  { _id: 'd', email: 'd', isVerified: false, resetToken: '222', resetExpires: now - 50000 },
];

// Tests

['paginated', 'non-paginated'].forEach(pagination => {
  const ifNonPaginated = pagination === 'non-paginated';

  describe(`reset ${pagination}`, () => {
    var db;
    var app;
    var users;
    var verifyReset;
    const password = '123456';

    beforeEach(() => {
      db = clone(usersDb);
      app = feathersStubs.app();
      users = feathersStubs.users(app, db, ifNonPaginated);
      verifyResetService().call(app); // define and attach verifyReset service
      verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset service
    });

    it('verifies valid token', (done) => {
      const resetToken = '000';

      verifyReset.create({ action: 'reset', value: { token: resetToken, password } }, {},
        (err, user) => {
          assert.strictEqual(err, null, 'err code set');
          assert.strictEqual(user.isVerified, true, 'isVerified not true');
          assert.strictEqual(user.resetToken, null, 'resetToken not null');
          assert.strictEqual(user.resetExpires, null, 'resetExpires not null');

          assert.isString(db[0].password, 'password not a string');
          assert.equal(db[0].password.length, 60, 'password wrong length');
          done();
        });
    });

    it('error on unverified user', (done) => {
      const resetToken = '222';
      verifyReset.create({ action: 'reset', value: { token: resetToken, password } }, {},
        (err, user) => {
          assert.equal(err.message, 'Email is not verified.');
          assert.deepEqual(err.errors, { $className: 'notVerified' });

          done();
        });
    });

    it('error on expired token', (done) => {
      const resetToken = '111';
      verifyReset.create({ action: 'reset', value: { token: resetToken, password } }, {},
        (err, user) => {
          assert.equal(err.message, 'Reset token has expired.');
          assert.deepEqual(err.errors, { $className: 'expired' });

          done();
        });
    });

    it('error on token not found', (done) => {
      const resetToken = '999';
      verifyReset.create({ action: 'reset', value: { token: resetToken, password } }, {},
        (err, user) => {
          assert.equal(err.message, 'Reset token not found.');
          assert.deepEqual(err.errors, { $className: 'notFound' });

          done();
        });
    });
  });

  describe(`reset with email ${pagination}`, () => {
    var db;
    var app;
    var users;
    var spyEmailer;
    var verifyReset;
    const password = '123456';

    beforeEach(() => {
      db = clone(usersDb);
      app = feathersStubs.app();
      users = feathersStubs.users(app, db, ifNonPaginated);
      spyEmailer = new SpyOn(emailer);

      verifyResetService({ emailer: spyEmailer.callWithCb }).call(app); // attach verifyReset
      verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset service
    });

    it('verifies valid token', (done) => {
      const resetToken = '000';

      verifyReset.create({ action: 'reset', value: { token: resetToken, password } }, {},
        (err, user) => {
          assert.strictEqual(err, null, 'err code set');
          assert.strictEqual(user.isVerified, true, 'isVerified not true');
          assert.strictEqual(user.resetToken, null, 'resetToken not null');
          assert.strictEqual(user.resetExpires, null, 'resetExpires not null');

          const hash = db[0].password;
          assert.isString(hash, 'password not a string');
          assert.equal(hash.length, 60, 'password wrong length');

          assert.deepEqual(spyEmailer.result(), [
            { args: ['reset', Object.assign({}, user, { password: hash }), {}], result: [null] },
          ]);

          done();
        });
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
