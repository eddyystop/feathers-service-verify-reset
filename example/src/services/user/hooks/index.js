
/* eslint no-console: 0 */

const hooks = require('feathers-hooks');
const auth = require('feathers-authentication').hooks;
const verifyHooks = require('../../../hooks').verifyResetHooks;

exports.before = {
  all: [],
  find: [
    auth.verifyToken(),
    auth.populateUser(),
    auth.restrictToAuthenticated(),
  ],
  get: [
    auth.verifyToken(),
    auth.populateUser(),
    auth.restrictToAuthenticated(),
    auth.restrictToOwner({ ownerField: '_id' }),
  ],
  create: [
    auth.hashPassword(),
    verifyHooks.addVerification(), // set email addr verification info
  ],
  update: [
    auth.verifyToken(),
    auth.populateUser(),
    auth.restrictToAuthenticated(),
    auth.restrictToOwner({ ownerField: '_id' }),
  ],
  patch: [
    auth.verifyToken(),
    auth.populateUser(),
    auth.restrictToAuthenticated(),
    auth.restrictToOwner({ ownerField: '_id' }),
  ],
  remove: [
    auth.verifyToken(),
    auth.populateUser(),
    auth.restrictToAuthenticated(),
    auth.restrictToOwner({ ownerField: '_id' }),
  ],
};

exports.after = {
  find: [
    hooks.remove('password'),
    verifyHooks.removeVerification(true), // return tokens for test scaffold
  ],
  get: [
    hooks.remove('password'),
    verifyHooks.removeVerification(true), // return tokens for test scaffold
  ],
  create: [
    hooks.remove('password'),
    userNotificationCreate, // send notification to verify the email addr
    verifyHooks.removeVerification(true), // return tokens for test scaffold
  ],
  update: [
    hooks.remove('password'),
    verifyHooks.removeVerification(true), // return tokens for test scaffold
  ],
  patch: [
    hooks.remove('password'),
    verifyHooks.removeVerification(),
  ],
  remove: [
    hooks.remove('password'),
    verifyHooks.removeVerification(),
  ],
};

function userNotificationCreate(hook, next) {
  // Data from the UI may be used to determine the transport for notifying the user.
  const user = hook.result;
  const slugForUrl = {
    socketio: 'socket',
    rest: 'rest',
  }[hook.params.provider];

  console.log('-- Sending notification to verify new user\'s email addr');
  console.log(`Dear ${user.username}, please click this link to verify your email addr.`);
  console.log(`  http://localhost:3030/${slugForUrl}/verify/${user.verifyToken}`);

  next(null, hook);
}
