
/* global assert, describe, it */
/* eslint  no-param-reassign: 0, no-shadow: 0, no-unused-vars: 0, no-var: 0, one-var: 0,
one-var-declaration-per-line: 0 */

const assert = require('chai').assert;
const feathersStubs = require('./../test/helpers/feathersStubs');
const verifyResetService = require('../lib/index').service;
const SpyOn = require('./../test/helpers/basicSpy');

const defaultVerifyDelay = 1000 * 60 * 60 * 24 * 5; // 5 days

// user DB

const now = Date.now();
const usersDb = [
  { _id: 'a', email: 'a', isVerified: false, verifyToken: '000', verifyExpires: now + 50000 },
  { _id: 'b', email: 'b', isVerified: true, verifyToken: null, verifyExpires: null },
];

// Tests

['_id', 'id'].forEach(idType => {
  ['paginated', 'non-paginated'].forEach(pagination => {
    describe(`verifyReset::resend ${pagination} ${idType}`, () => {
      const ifNonPaginated = pagination === 'non-paginated';

      describe('email string', () => {
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

        it('verifyReset::create exists', () => {
          assert.isFunction(verifyReset.create);
        });

        it('updates unverified user', (done) => {
          const email = 'a';
          const i = 0;

          verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
            assert.strictEqual(err, null, 'err code set');

            assert.strictEqual(user.isVerified, false, 'user.isVerified not false');

            assert.strictEqual(db[i].isVerified, false, 'isVerified not false');
            assert.isString(db[i].verifyToken, 'verifyToken not String');
            assert.equal(db[i].verifyToken.length, 30, 'verify token wrong length');
            aboutEqualDateTime(db[i].verifyExpires, makeDateTime());

            done();
          });
        });

        it('error on verified user', (done) => {
          const email = 'b';
          verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
            assert.equal(err.message, 'User is already verified.');

            done();
          });
        });

        it('error on email not found', (done) => {
          const email = 'x';
          verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
            assert.equal(err.message, 'Email or verify token not found.');

            done();
          });
        });
      });

      describe('email string user is sanitized', () => {
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

        it('updates unverified user', (done) => {
          const email = 'a';

          verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
            assert.strictEqual(err, null, 'err code set');

            assert.strictEqual(user.isVerified, false, 'isVerified not false');
            assert.strictEqual(user.verifyToken, undefined, 'verifyToken not undefined');
            assert.strictEqual(user.verifyExpires, undefined, 'verifyExpires not undefined');

            done();
          });
        });
      });

      describe('email object', () => {
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

        it('verifyReset::create exists', () => {
          assert.isFunction(verifyReset.create);
        });

        it('updates unverified user', (done) => {
          const email = 'a';
          const i = 0;

          verifyReset.create({ action: 'resend', value: { email } }, {}, (err, user) => {
            assert.strictEqual(err, null, 'err code set');

            assert.strictEqual(user.isVerified, false, 'user.isVerified not false');

            assert.strictEqual(db[i].isVerified, false, 'isVerified not false');
            assert.isString(db[i].verifyToken, 'verifyToken not String');
            assert.equal(db[i].verifyToken.length, 30, 'verify token wrong length');
            aboutEqualDateTime(db[i].verifyExpires, makeDateTime());

            done();
          });
        });

        it('error on verified user', (done) => {
          const email = 'b';
          verifyReset.create({ action: 'resend', value: { email } }, {}, (err, user) => {
            assert.equal(err.message, 'User is already verified.');

            done();
          });
        });

        it('error on email not found', (done) => {
          const email = 'x';
          verifyReset.create({ action: 'resend', value: { email } }, {}, (err, user) => {
            assert.equal(err.message, 'Email or verify token not found.');

            done();
          });
        });
      });

      describe('token object', () => {
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

        it('verifyReset::create exists', () => {
          assert.isFunction(verifyReset.create);
        });

        it('updates unverified user', (done) => {
          const verifyToken = '000';
          const i = 0;

          verifyReset.create({ action: 'resend', value: { verifyToken } }, {}, (err, user) => {
            assert.strictEqual(err, null, 'err code set');

            assert.strictEqual(user.isVerified, false, 'user.isVerified not false');

            assert.strictEqual(db[i].isVerified, false, 'isVerified not false');
            assert.isString(db[i].verifyToken, 'verifyToken not String');
            assert.equal(db[i].verifyToken.length, 30, 'verify token wrong length');
            aboutEqualDateTime(db[i].verifyExpires, makeDateTime());

            done();
          });
        });

        it('error on verified user', (done) => {
          const verifyToken = null;
          verifyReset.create({ action: 'resend', value: { verifyToken } }, {}, (err, user) => {
            assert.equal(err.message, 'User is already verified.');
            assert.deepEqual(err.errors, {
              email: 'User is already verified.', token: 'User is already verified.',
            });

            done();
          });
        });

        it('error on token not found', (done) => {
          const verifyToken = 'x';
          verifyReset.create({ action: 'resend', value: { verifyToken } }, {}, (err, user) => {
            assert.equal(err.message, 'Email or verify token not found.');
            assert.deepEqual(err.errors, { email: 'Not found.', token: 'Not found.' });

            done();
          });
        });
      });

      describe('with email', () => {
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

          verifyResetService({ emailer: spyEmailer.callWithCb }).call(app);
          verifyReset = app.service('/verifyReset/:action/:value'); // get handle to verifyReset
        });

        it('updates unverified user', (done) => {
          const email = 'a';
          const i = 0;

          verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
            assert.strictEqual(err, null, 'err code set');

            assert.strictEqual(user.isVerified, false, 'user.isVerified not false');

            assert.strictEqual(db[i].isVerified, false, 'isVerified not false');
            assert.isString(db[i].verifyToken, 'verifyToken not String');
            assert.equal(db[i].verifyToken.length, 30, 'verify token wrong length');
            aboutEqualDateTime(db[i].verifyExpires, makeDateTime());

            assert.deepEqual(spyEmailer.result(), [
              { args: ['resend', sanitizeUserForEmail(db[i]), {}], result: [null] },
            ]);

            done();
          });
        });
      });

      describe('works as Promise', () => {
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

        it('updates unverified user', (done) => {
          const email = 'a';
          const i = 0;

          verifyReset.create({ action: 'resend', value: email }, {})
            .then(user => {
              assert.strictEqual(user.isVerified, false, 'user.isVerified not false');

              assert.strictEqual(db[i].isVerified, false, 'isVerified not false');
              assert.isString(db[i].verifyToken, 'verifyToken not String');
              assert.equal(db[i].verifyToken.length, 30, 'verify token wrong length');
              aboutEqualDateTime(db[i].verifyExpires, makeDateTime());

              done();
            })
            .catch(err => {
              assert.fail(true, false, 'unexpected rejection');
            });
        });

/*
        it('error on verified user', (done) => {
          const email = 'b';
          verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
            assert.equal(err.message, 'User is already verified.');

            done();
          });
        });

        it('error on email not found', (done) => {
          const email = 'x';
          verifyReset.create({ action: 'resend', value: email }, {}, (err, user) => {
            assert.equal(err.message, 'Email or verify token not found.');

            done();
          });
        });
        */
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
  return Date.now() + (options1.delay || defaultVerifyDelay);
}

function aboutEqualDateTime(time1, time2, msg, delta) {
  delta = delta || 500;
  const diff = Math.abs(time1 - time2);
  assert.isAtMost(diff, delta, msg || `times differ by ${diff}ms`);
}

function sanitizeUserForEmail(user) {
  const user1 = clone(user);

  delete user1.password;

  return user1;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
