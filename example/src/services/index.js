
/* eslint no-console: 0 */

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
  console.log(`-- Sending email for ${action}`);
  const provider = params.provider;
  const route = provider === 'rest' ? 'rest' : 'socket';

  switch (action) {
    case 'resend': // send another email with link for verifying user's email addr
      console.log(`Dear ${user1.username}, please click this link to verify your email addr.`);
      console.log(`  http://localhost:3030/${route}/verify/${user1.verifyToken}`);
      break;
    case 'verify': // inform that user's email is now confirmed
      break;
    case 'forgot': // send email with link for resetting forgotten password
      console.log(`Dear ${user1.username}, please click this link to reset your password.`);
      console.log(`  http://localhost:3030/${route}/reset/${user1.resetToken}`);
      break;
    case 'reset': // inform that forgotten password has now been reset
      break;
    default:
      break;
  }

  cb(null);
}
