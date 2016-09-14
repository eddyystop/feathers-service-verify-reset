
/* global assert, describe, it */
/* eslint  no-shadow: 0, no-unused-vars: 0, no-var: 0, one-var: 0,
one-var-declaration-per-line: 0 */

const assert = require('chai').assert;
const feathersStubs = require('./../test/helpers/feathersStubs');
const verifyResetService = require('../lib/index').service;
const SpyOn = require('./../test/helpers/basicSpy');

// user DB

const now = Date.now();
const usersDb = [
  { _id: 'a', email: 'a', isVerified: false, verifyToken: '000', verifyExpires: now + 50000 },
  { _id: 'b', email: 'b', isVerified: true, verifyToken: null, verifyExpires: null },
  { _id: 'c', email: 'c', isVerified: false, verifyToken: '111', verifyExpires: now - 50000 },
];

// Tests
['_id', 'id'].forEach(idType => {
  ['paginated', 'non-paginated'].forEach(pagination => {
    const ifNonPaginated = pagination === 'non-paginated';

    describe(`verifyReset::verify ${pagination} ${idType}`, () => {
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
        verifyReset.create({ action: 'verify', value: verifyToken }, {}, (err) => {
          assert.equal(err.message, 'Verification token has expired.');
          assert.equal(err.errors.$className, 'expired');

          done();
        });
      });

      it('error on null token', (done) => {
        const verifyToken = null;
        verifyReset.create({ action: 'verify', value: verifyToken }, {}, (err) => {
          assert.equal(err.message, 'User is already verified.');
          assert.equal(err.errors.$className, 'alreadyVerified');

          done();
        });
      });

      it('error on token not found', (done) => {
        const verifyToken = '999';
        verifyReset.create({ action: 'verify', value: verifyToken }, {}, (err) => {
          assert.equal(err.message, 'Verification token was not issued.');
          assert.equal(err.errors.$className, 'notIssued');

          done();
        });
      });
    });

    describe(`verifyReset::verify with email ${pagination} ${idType}`, () => {
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
  });
});

// Helpers

function emailer(action, user, params, cb) {
  cb(null);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
