
const crypto = require('crypto');
const errors = require('feathers-errors');
const auth = require('feathers-authentication').hooks;
const utils = require('feathers-hooks-utils');
const debug = require('debug')('verifyReset');

const defaultVerifyDelay = 1000 * 60 * 60 * 24 * 5; // 5 days
const defaultResetDelay = 1000 * 60 * 60 * 2; // 2 hours

/*
 Service
 */

/**
 * Feathers-service-verify-reset service to verify user's email, and to reset forgotten password.
 *
 * @param {Function?} emailer (action, user, provider, cb) sends an email for 'action'.
 *    action    function performed: resend, verify, forgot, reset.
 *    user      user's information.
 *    provider  transport used: rest (incl raw HTTP), socketio, primus or undefined (internal)
 *
 *    The forgot (reset forgotten password) and resend (resend user email verification)
 *    are needed to provide the user a link. The other emails are optional.
 * @returns {Function} Featherjs service
 *
 * This service does not handle the email on creation of a new user account.
 * That is handled with hooks on the 'users' service 'create' method, e.g.
 *
 * const verifyHooks = require('feathers-service-verify-reset').verifyResetHooks;
 * export.before = {
 *   create: [
 *     auth.hashPassword(),
 *     verifyHooks.addVerification() // add .isVerified, .verifyExpires, .verifyToken
 *   ]
 * };
 * export.after = {
 *   create: [
 *     hooks.remove('password'),
 *     aHookToEmailYourVerification(),
 *     verifyHooks.removeVerification() // removes verification/reset fields other than .isVerified
 *   ]
 * };
 */
module.exports.service = function (emailer) {
  debug(`service configured. typeof emailer=${typeof emailer}`);
  if (!emailer) { emailer = function () {} }

  return function () { // 'function' needed as we use 'this'
    debug('service initialized');
    const app = this;
    var users;
    var params;

    app.use('/verifyReset/:action/:value', {
      create(data, params1, cb) {
        debug(`service called. action=${data.action} value=${data.value}`);
        users = app.service('/users'); // here in case users service is configured after verifyReset
        params = params1;

        switch (data.action) {
          case 'resend':
            resendVerifySignUp(data.value, cb);
            break;
          case 'verify':
            verifySignUp(data.value, cb);
            break;
          case 'forgot':
            sendResetPwd(data.value, cb);
            break;
          case 'reset':
            resetPwd(data.value, data.data, cb);
            break;
          default:
            throw new errors.BadRequest(`Action "${data.action}" is invalid.`)
        }
      }
    });

    function resendVerifySignUp (email, cb) {
      debug('resend');
      users.find({query: {email}})
        .then(data => {
          if (data.total === 0) {
            return cb(new errors.BadRequest(`Email "${email}" not found.`));
          }

          const user = data.data[0]; // Only 1 entry as emails must be unique

          if (user.isVerified) {
            return cb(new errors.BadRequest(`User is already verified.`));
          }

          addVerifyProps(user, {}, (err, user) => {
            users.update(user._id, user, {}, (err, user) => {
              if (err) { throw new errors.GeneralError(err); }

              emailer('resend', clone(user), params, (err) => {
                debug('resend. Completed.');
                cb(err, getClientUser(user));
              });
            });
          });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function verifySignUp (token, cb) {
      debug('verify');
      users.find({query: {verifyToken: token}})
        .then(data => {
          if (data.total === 0) {
            return cb(new errors.BadRequest(`Verification token not found.`));
          }

          const user = data.data[0]; // Only 1 entry as token are unique

          if (user.isVerified) {
            return cb(new errors.BadRequest(`User is already verified.`));
          }

          user.isVerified = user.verifyExpires > Date.now();
          user.verifyExpires = null;
          user.verifyToken = null;
          if ('resetToken' in user) {
            user.resetToken = null;
          }
          if ('resetExpires' in user) {
            user.resetExpires = null;
          }

          if (!user.isVerified) {
            return cb(new errors.BadRequest(`Verification token has expired.`));
          }

          users.update(user._id, user, {}, (err, user) => {
            if (err) { throw new errors.GeneralError(err); }

            emailer('verify', clone(user), params, (err) => {
              debug('verify. Completed.');
              cb(err, getClientUser(user));
            });
          });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function sendResetPwd (email, cb) {
      debug('forgot');
      users.find({query: {email}})
        .then(data => {
          if (data.total === 0) {
            return cb(new errors.BadRequest(`Email "${email}" not found.`));
          }

          const user = data.data[0]; // Only 1 entry as emails must be unique

          if (!user.isVerified) {
            return cb(new errors.BadRequest(`User\'s email is not yet verified.`));
          }

          crypto.randomBytes(15, (err, buf) => {
            if (err) {
              throw new errors.GeneralError(err);
            }

            user.resetExpires = Date.now() + defaultResetDelay;
            user.resetToken = buf.toString('hex');

            users.update(user._id, user, {}, (err, user) => {
              if (err) { throw new errors.GeneralError(err); }

              emailer('forgot', clone(user), params, (err) => {
                debug('forgot. Completed.');
                cb(err, getClientUser(user));
              });
            });
          });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function resetPwd (token, json, cb) {
      debug(`reset. json=${JSON.stringify(json)}`);
      users.find({query: {resetToken: token}})
        .then(data => {
          if (data.total === 0) {
            return cb(new errors.BadRequest(`Reset token not found.`));
          }

          const user = data.data[0]; // Only 1 entry as token are unique

          if (!user.isVerified) {
            return cb(new errors.BadRequest(`User\'s email is not verified.`));
          }
          if (user.resetExpires < Date.now()) {
            return cb(new errors.BadRequest(`Reset token has expired.`));
          }

          // hash the password just like create: [ auth.hashPassword() ]

          const hook = {
            type: 'before',
            data: {password: json.password},
            params: {provider: null},
            app: {
              get(str) {
                return app.get(str);
              },
            },
          };

          debug('reset. hashing password.');
          auth.hashPassword()(hook)
            .then(hook => {
              user.password = hook.data.password;
              user.resetExpires = null;
              user.resetToken = null;

              users.update(user._id, user, {}, (err, user) => {
                if (err) { throw new errors.GeneralError(err); }

                emailer('reset', clone(user), params, (err) => {
                  debug('reset. Completed.');
                  cb(err, getClientUser(user));
                });
              });
            })
            .catch(err => {
              throw new errors.GeneralError(err);
            });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function getClientUser (user) {
      const client = clone(user);
      delete client.password;
      return client;
    }
  };
};

/*
 Hooks
 */

module.exports.hooks = {};

module.exports.hooks.addVerification = (options) => (hook, next) => {
  utils.checkContext(hook, 'before', 'create');

  addVerifyProps(hook.data, options, (err, data) => {
    hook.data = data;
    next(null, hook);
  });
};

module.exports.hooks.restrictToVerified = () => (hook) => {
  utils.checkContext(hook, 'before');

  if (!hook.params.user || !hook.params.user.isVerified) {
    throw new errors.BadRequest('User\'s email is not yet verified.');
  }
};

module.exports.hooks.removeVerification = (ifReturnTokens) => (hook) => {
  utils.checkContext(hook, 'after');
  const user = hook.result;

  if (user) {
    delete user.verifyExpires;
    delete user.resetExpires;
    if (!ifReturnTokens) {
      delete user.verifyToken;
      delete user.resetToken
    }
  }
};

/*
 Helpers
 */

const addVerifyProps = (data, options, cb) => {
  options = options || {};

  crypto.randomBytes(options.len || 15, (err, buf) => {
    if (err) { throw new errors.GeneralError(err); }

    data.isVerified = false;
    data.verifyExpires = Date.now() + (options.delay || defaultVerifyDelay);
    data.verifyToken = buf.toString('hex');

    cb(null, data);
  });
};

function clone (obj) {
  return JSON.parse(JSON.stringify(obj));
}
