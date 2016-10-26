
/* eslint quotes: 0, no-console: 0 */

const message = require('./message');
const authentication = require('./authentication');
const user = require('./user');
const verifyReset = require('../../../src').service;

module.exports = function () { // 'function' needed as we use 'this'
  const app = this;

  app.configure(authentication);
  app.configure(verifyReset({ emailer }));
  app.configure(user);
  app.configure(message);
};

function emailer(action, user1, params, cb) {
  const myBrand = 'Feathersjs';
  const myUrl = 'feathers.com';
  const slugForUrl = {
    socketio: 'socket',
    rest: 'rest',
  }[params.provider];

  switch (action) {
    case 'resend':
      console.log(`-- Resending email to ${user1.email} to verify new user's email addr`);
      console.log(`Dear ${user1.username}, please click this link to verify your email addr.`);
      console.log(`  http://localhost:3030/${slugForUrl}/verify/${user1.verifyToken}`);
      return cb(null);
    case 'verify':
      console.log(`-- Sending email to ${user1.email} to confirm they are verified.`);
      console.log(`Dear ${user1.username}, your email has been verified at ${myBrand}.`);
      console.log(`  You can sign in at ${myUrl}.`);
      return cb(null);
    case 'forgot':
      console.log(`-- Resending email to ${user1.email} to reset password`);
      console.log(`Dear ${user1.username}, please click this link to reset your password.`);
      console.log(`  http://localhost:3030/${slugForUrl}/forgot/${user1.resetToken}`);
      return cb(null);
    case 'reset':
      console.log(`-- Sending email to ${user1.email} to notify them of password change.`);
      console.log(`Dear ${user1.username}, your password at ${myBrand} has been changed`);
      console.log(`  by password rest. Please contact us if you did not initiate this change.`);
      console.log(`  You can sign in at ${myUrl}.`);
      return cb(null);
    case 'password':
      console.log(`-- Sending email to ${user1.email} to notify them of password change.`);
      console.log(`Dear ${user1.username}, your password at ${myBrand} has been changed`);
      console.log(`  manually. Please contact us if you did not initiate this change.`);
      console.log(`  You can sign in at ${myUrl}.`);
      return cb(null);
    case 'email':
      console.log(`-- Sending email to ${user1.email} to notify them of email change.`);
      console.log(`Dear ${user1.username}, your email address at ${myBrand} is being`);
      console.log(`  changed from this address to ${user1.newEmail}.`);
      console.log(`  Please contact us if you did not initiate this change.`);
      console.log(`  You can sign in at ${myUrl}.`);
      return cb(null);
    default:
      break;
  }

  return cb(null);
}
