
/* eslint quotes: 0, no-console: 0 */

const message = require('./message');
const authentication = require('./authentication');
const user = require('./user');
const verifyReset = require('../../../src').service;

module.exports = function () { // 'function' needed as we use 'this'
  const app = this;

  app.configure(authentication);
  app.configure(verifyReset({ userNotifier }));
  app.configure(user);
  app.configure(message);
};

function userNotifier(type, user1, notifierOptions = {}, newEmail, cb) {
  const myBrand = 'Feathersjs';
  const myUrl = 'feathers.com';
  var route; // eslint-disable-line no-var

  switch (type) {
    case 'resendVerifySignup':
      route = notifierOptions.route;
      console.log(`-- Resending notification to ${user1.email} to verify new user's email addr`);
      console.log(`Dear ${user1.username}, please click this link to verify your email addr.`);
      console.log(`  http://localhost:3030/${route}/verify/${user1.verifyToken}`);
      return cb(null);
    case 'verifySignup':
      console.log(`-- Sending notification to ${user1.email} to confirm they are verified.`);
      console.log(`Dear ${user1.username}, your email has been verified at ${myBrand}.`);
      console.log(`  You can sign in at ${myUrl}.`);
      return cb(null);
    case 'sendResetPwd':
      route = notifierOptions.route;
      console.log(`-- Resending notification to ${user1.email} to reset password`);
      console.log(`Dear ${user1.username}, please click this link to reset your password.`);
      console.log(`  http://localhost:3030/${route}/forgot/${user1.resetToken}`);
      console.log(`  Transport selected on UI was ${JSON.stringify(notifierOptions)}`);
      return cb(null);
    case 'resetPwd':
      console.log(`-- Sending notification to ${user1.email} to notify them of password change.`);
      console.log(`Dear ${user1.username}, your password at ${myBrand} has been changed`);
      console.log(`  by password reset. Contact us if you did not initiate this change.`);
      console.log(`  You can sign in at ${myUrl}.`);
      return cb(null);
    case 'passwordChange':
      console.log(`-- Sending notification to ${user1.email} to notify them of password change.`);
      console.log(`Dear ${user1.username}, your password at ${myBrand} has been changed`);
      console.log(`  manually. Please contact us if you did not initiate this change.`);
      console.log(`  You can sign in at ${myUrl}.`);
      return cb(null);
    case 'emailChange':
      console.log(`-- Sending notification to ${user1.email} to notify them of email change.`);
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
