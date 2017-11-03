
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
const validToken1 = '123456789012345678901234567890';
const validToken2 = '123456789012345678901234567877';
const validToken3 = '123456789012345678901234567899';
const invalidToken = '111111111111111111111111111111';
const expiresAt = now + 50000;
const usersDb = [
  { _id: 'a', email: 'a', isVerified: true, resetToken: validToken1, resetExpires: expiresAt },
  { _id: 'b', email: 'b', isVerified: false, verifyToken: null, verifyExpires: null },
  { _id: 'c', email: 'c', isVerified: false, resetToken: validToken2, resetExpires: expiresAt },
  { _id: 'd', email: 'd', isVerified: true, resetToken: validToken2, resetExpires: now - 50000 },
];

// Tests

['_id', 'id'].forEach(idType => {
  ['paginated', 'non-paginated'].forEach(pagination => {
    describe(`checkResetLongTokenValid ${pagination} ${idType}`, () => {
      const ifNonPaginated = pagination === 'non-paginated';

      describe('basic', () => {
        var db;
        var app;
        var users;
        var verifyReset;

        beforeEach(() => {
          db = clone(usersDb);
          app = feathersStubs.app();
          users = feathersStubs.users(app, db, ifNonPaginated, idType);
          verifyResetService().call(app); // define and attach verifyReset service
          verifyReset = app.service('verifyReset'); // get handle to verifyReset
        });

        it('returns `valid`', (done) => {
          const i = 0;

          verifyReset.create({ action: 'checkResetLongTokenValid', value: validToken1 }, {}, (err, data) => {
            assert.strictEqual(err, null, 'err code set');

            assert.deepEqual(data, { valid: true }, 'valid is not true');

            assert.isString(db[i].resetToken, 'resetToken not String');
            assert.equal(db[i].resetToken, validToken1, 'resetToken changed');
            assert.equal(db[i].resetToken.length, 30, 'reset token wrong length');
            assert.equal(db[i].resetExpires, expiresAt, 'resetExpires changed');

            done();
          });
        });

        it('error on unverified user', (done) => {
          verifyReset.create({ action: 'checkResetLongTokenValid', value: validToken2 }, {}, (err, data) => {
            assert.isString(err.message);
            assert.isNotFalse(err.message);

            done();
          });
        });

        it('error on token not found', (done) => {
          verifyReset.create({ action: 'checkResetLongTokenValid', value: invalidToken }, {}, (err, user) => {
            assert.isString(err.message);
            assert.isNotFalse(err.message);

            done();
          });
        });

        it('error on token expired', (done) => {
          verifyReset.create({ action: 'checkResetLongTokenValid', value: validToken3 }, {}, (err, user) => {
            assert.isString(err.message);
            assert.isNotFalse(err.message);

            done();
          });
        });

        it('works as promise', (done) => {
          const i = 0;

          verifyReset.create({ action: 'checkResetLongTokenValid', value: validToken1 })
          .then(data => {
            assert.deepEqual(data, { valid: true }, 'valid is not true');

            assert.isString(db[i].resetToken, 'resetToken not String');
            assert.equal(db[i].resetToken, validToken1, 'resetToken changed');
            assert.equal(db[i].resetToken.length, 30, 'reset token wrong length');
            assert.equal(db[i].resetExpires, expiresAt, 'resetExpires changed');

            done();
          })
          .catch(err => {
            assert.fail(false, true, 'unexpected catch');
          });
        });
      });
    });
  });
});


// Helpers

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
