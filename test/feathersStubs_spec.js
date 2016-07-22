
/* global assert, describe, it */
/* eslint  no-shadow: 0, no-var: 0, one-var: 0, one-var-declaration-per-line: 0 */

const assert = require('chai').assert;
const debug = require('debug')('test:verifyReset_spec');
const feathersStubs = require('./helpers/feathersStubs');

// user DB

const now = Date.now();
const usersDb = [
  { _id: 'a', email: 'a', isVerified: false, verifyToken: '000', verifyExpires: now + 50000 },
  { _id: 'b', email: 'b', isVerified: true, verifyToken: null, verifyExpires: null },
];

// Tests

describe('feathersStubs::users', () => {
  var app;
  var users;

  beforeEach(() => {
    app = feathersStubs.app();
    users = feathersStubs.users(app, usersDb);
  });

  it('mock of users::find works', (done) => {
    //assert.isFunction(verifyReset.create);
    users.find({ query: { email: 'a' } })
      .then(({ total, data }) => {

        assert.equal(total, 1);
        assert.deepEqual(data[0], usersDb[0]);

        done();
      })
      .catch(err => {
        assert.isNotOk(true, '.catch on find');
        done();
      });
  });

  it('mock of users::update works', (done) => {
    const id = usersDb[0]._id;
    const newRec = { _id: id, email: 'abc123' };

    users.update(id, newRec, {}, (err, data) => {
      users.find({ query: { email: 'abc123' } })
        .then(({ total, data }) => {

          assert.equal(total, 1);
          assert.deepEqual(data[0], newRec);

          done();
        })
        .catch(err => {
          assert.isNotOk(true, '.catch on find');
          done();
        });
    });
  });
});
