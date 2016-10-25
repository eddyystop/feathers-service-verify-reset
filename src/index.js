
/* eslint consistent-return: 0, no-param-reassign: 0, no-underscore-dangle: 0,
no-var: 0, vars-on-top: 0 */

const crypto = require('crypto');
const errors = require('feathers-errors');
const auth = require('feathers-authentication').hooks;
const bcrypt = require('bcryptjs');
const hooks = require('feathers-hooks-common');
const utils = require('feathers-hooks-common/lib/utils');
const debug = require('debug')('verifyReset');

const defaultVerifyDelay = 1000 * 60 * 60 * 24 * 5; // 5 days
const defaultResetDelay = 1000 * 60 * 60 * 2; // 2 hours

/**
 * Feathers-service-verify-reset service to verify user's email, and to reset forgotten password.
 *
 * @param {Object?} options - for service
 *
 * options.emailer - function(action, user, provider, cb) sends an email for 'action'.
 *    action    function performed: resend, verify, forgot, reset.
 *    user      user's information.
 *    provider  transport used: rest (incl raw HTTP), socketio, primus or undefined (internal)
 *
 *    The forgot (reset forgotten password) and resend (resend user email verification)
 *    are needed to provide the user a link. The other emails are optional.
 *
 * options.delay - duration for sign up email verification token in ms. Default is 5 days.
 * options.resetDelay - duration for password reset token in ms. Default is 2 hours.
 *
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
module.exports.service = function (options) {
  options = options || {};
  debug(`service configured. typeof emailer=${typeof options.emailer}`);

  const emailer = options.emailer || ((p1, p2, p3, cb) => { cb(null); });
  const resetDelay = options.resetDelay || defaultResetDelay;

  return function verifyReset() { // 'function' needed as we use 'this'
    debug('service initialized');
    const app = this;
    const path = '/verifyReset/:action/:value';
    var users;
    var params;

    const isAction = (...args) => hook => args.indexOf(hook.data.action) !== -1;

    app.use(path, {
      before: {
        create: [
          hooks.iff(isAction('password', 'email'), auth.verifyToken()),
          hooks.iff(isAction('password', 'email'), auth.populateUser()),
        ],
      },
      create(data, params1, cb) {
        debug(`service called. action=${data.action} value=${JSON.stringify(data.value)}`);
        users = app.service('/users'); // here in case users service is configured after verifyReset
        params = params1;

        switch (data.action) {
          case 'unique':
            // the 'return' is needed as this return a promise
            return checkUniqueness(data.value, data.ownId || null, data.meta || {});
          case 'resend':
            return resendVerifySignUp(data.value, cb);
          case 'verify':
            return verifySignUp(data.value, cb);
          case 'forgot':
            return sendResetPwd(data.value, cb);
          case 'reset':
            return resetPwd(data.value.token, data.value.password, cb);
          case 'password':
            return passwordChange(params.user, data.value.oldPassword, data.value.password, cb);
          case 'email':
            return emailChange(params.user, data.value.password, data.value.email, cb);
          default:
            throw new errors.BadRequest(`Action "${data.action}" is invalid.`);
        }
      },
    });

    function checkUniqueness(uniques, ownId, meta) {
      const errs = {};
      const keys = Object.keys(uniques).filter(
        key => uniques[key] !== undefined && uniques[key] !== null);
      let keysLeft = keys.length;

      return new Promise((resolve, reject) => {
        if (!keysLeft) {
          return resolve();
        }

        keys.forEach(prop => {
          debug(`query ${prop}:${uniques[prop].trim()}`);
          users.find({ query: { [prop]: uniques[prop].trim() /* , $limit: 1 */ } }) // 1 as unique
            .then(data => {
              const items = Array.isArray(data) ? data : data.data;
              if (items.length > 1
                || (items.length === 1 && (items[0].id || items[0]._id) !== ownId)
              ) {
                errs[prop] = 'Already taken.';
              }

              // Check results on last async operation
              if (--keysLeft <= 0) {
                if (!Object.keys(errs).length) {
                  resolve();
                }

                reject(new errors.BadRequest(
                  meta.noErrMsg ? null : 'Values already taken.', { errors: errs }
                ));
              }
            })
            .catch(err => {
              reject(new errors.GeneralError(err));
            });
        });
      });
    }

    function resendVerifySignUp(emailOrToken, cb) {
      debug('resend', emailOrToken);
      var query = {};

      // form query string
      if (typeof emailOrToken === 'string') {
        query = { email: emailOrToken };
      } else {
        if ('email' in emailOrToken) {
          query.email = emailOrToken.email;
        }
        if ('verifyToken' in emailOrToken) {
          query.verifyToken = emailOrToken.verifyToken;
        }
      }

      users.find({ query })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest('Email or verify token not found.',
              { errors: { email: 'Not found.', token: 'Not found.' } }
            ));
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (user.isVerified) {
            return cb(new errors.BadRequest('User is already verified.',
              { errors: { email: 'User is already verified.', token: 'User is already verified.' } }
            ));
          }

          crypto.randomBytes(options.len || 15, (err, buf) => {
            if (err) { throw new errors.GeneralError(err); }

            return patchUserAndSendEmail(user, 'resend', cb, {
              isVerified: false,
              verifyExpires: Date.now() + defaultVerifyDelay,
              verifyToken: buf.toString('hex'),
            });
          });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function verifySignUp(token, cb) {
      debug(`verify ${token}`);

      users.find({ query: { verifyToken: token } })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest(
              'Verification token was not issued.', { errors: { $className: 'notIssued' } }
            ));
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (user.isVerified) {
            return cb(new errors.BadRequest(
              'User is already verified.', { errors: { $className: 'alreadyVerified' } }
            ));
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
            return cb(new errors.BadRequest(
              'Verification token has expired.',
              { errors: { $className: 'expired' } }
            ));
          }

          return patchUserAndSendEmail(user, 'verify', cb, {
            isVerified: user.isVerified,
            verifyExpires: user.verifyExpires,
            verifyToken: user.verifyToken,
            resetToken: user.resetToken,
            resetExpires: user.resetExpires,
          });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function sendResetPwd(email, cb) {
      debug('forgot');
      users.find({ query: { email } })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest(
              'Email not found.', { errors: { email: 'Not found.' } }
            ));
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (!user.isVerified) {
            return cb(new errors.BadRequest(
              'Email is not yet verified.', { errors: { email: 'Not verified.' } }
            ));
          }
          crypto.randomBytes(15, (err, buf) => {
            if (err) {
              throw new errors.GeneralError(err);
            }

            return patchUserAndSendEmail(user, 'forgot', cb, {
              resetExpires: Date.now() + resetDelay,
              resetToken: buf.toString('hex'),
            });
          });
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function resetPwd(token, password, cb) {
      debug('reset', token, password);
      users.find({ query: { resetToken: token } })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest(
              'Reset token not found.', { errors: { $className: 'notFound' } }
            ));
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (!user.isVerified) {
            return cb(new errors.BadRequest(
              'Email is not verified.', { errors: { $className: 'notVerified' } }
            ));
          }
          if (user.resetExpires < Date.now()) {
            return cb(new errors.BadRequest(
              'Reset token has expired.', { errors: { $className: 'expired' } }
            ));
          }

          // hash the password just like create: [ auth.hashPassword() ]

          const hook = {
            type: 'before',
            data: { password },
            params: { provider: null },
            app: {
              get(str) {
                return app.get(str);
              },
            },
          };

          debug('reset. hashing password.');
          auth.hashPassword()(hook)
            .then(hook1 => patchUserAndSendEmail(user, 'reset', cb, {
              password: hook1.data.password,
              resetToken: null,
              resetExpires: null,
            })
          );
        })
        .catch(err => {
          throw new errors.GeneralError(err);
        });
    }

    function passwordChange(user, oldPassword, password, cb) {
      // get user to obtain current password
      users.find({ query: { email: user.email } })
        .then(data => {
          const user1 = Array.isArray(data) ? data[0] : data.data[0]; // email is unique

          // compare old password to encrypted current password
          bcrypt.compare(oldPassword, user1.password, (err, data1) => {
            if (err || !data1) {
              return cb(new errors.BadRequest('Current password is incorrect.',
                { errors: { oldPassword: 'Current password is incorrect.' } }
              ));
            }

            // encrypt the new password
            const hook = {
              type: 'before',
              data: { password },
              params: { provider: null },
              app: {
                get(str) {
                  return app.get(str);
                },
              },
            };
            auth.hashPassword()(hook)
              .then(hook1 => patchUserAndSendEmail(user1, 'password', cb, {
                password: hook1.data.password,
              })
            );
          });
        })
        .catch(err => {
          cb(new errors.GeneralError(err));
        });
    }


    // note this call does not update the authenticated user info in hooks.params.user.
    function emailChange(user, password, email, cb) {
      // get user to obtain current password
      const idType = user._id ? '_id' : 'id';
      users.find({ query: { [idType]: user[idType] } })
        .then(data => {
          const user1 = Array.isArray(data) ? data[0] : data.data[0]; // email is unique

          // compare old password to encrypted current password
          bcrypt.compare(password, user1.password, (err, data1) => {
            if (err || !data1) {
              return cb(new errors.BadRequest('Password is incorrect.',
                { errors: { password: 'Password is incorrect.' } }
              ));
            }

            // send email
            const user3 = sanitizeUserForEmail(user1);
            user3.newEmail = email;
            emailer('email', sanitizeUserForEmail(user3), params, () => {});

            return patchUserAndSendEmail(user1, 'email', cb, { email }, false);
          });
        })
        .catch(err => {
          cb(new errors.GeneralError(err));
        });
    }

    // Helpers

    function patchUserAndSendEmail(user /* modified */, emailAction, cb, patchToUser, ifEmail) {
      debug(`${emailAction}. Patch user.`);
      Object.assign(user, patchToUser);
      if (ifEmail === undefined) {
        ifEmail = true;
      }

      const promise = users.patch(user.id || user._id, patchToUser, {})
        .then(() => new Promise((resolve, reject) => {
          if (!ifEmail) {
            return resolve();
          }

          emailer(emailAction, sanitizeUserForEmail(user), params, err2 => {
            debug(`${emailAction}. Completed.`);
            return err2 ? reject(err2) : resolve();
          });
        })
        )
        .then(() => sanitizeUserForClient(user));

      return cb ? promiseToCallback(promise)(cb) : promise;
    }

    function promiseToCallback(promise) {
      return function (cb) {
        promise.then(
          data => {
            process.nextTick(cb, null, data);
          },
          err => {
            process.nextTick(cb, err);
          });
      };
    }

    function sanitizeUserForClient(user) {
      const user1 = Object.assign({}, user);

      delete user1.password;
      delete user1.verifyExpires;
      delete user1.verifyToken;
      delete user1.resetExpires;
      delete user1.resetToken;

      return user1;
    }

    function sanitizeUserForEmail(user) {
      const user1 = Object.assign({}, user);

      delete user1.password;

      return user1;
    }
  };
};

// Hooks

module.exports.hooks = {};

module.exports.hooks.addVerification = (options) => (hook, next) => {
  options = options || {};
  utils.checkContext(hook, 'before', 'create');

  crypto.randomBytes(options.len || 15, (err, buf) => {
    if (err) { throw new errors.GeneralError(err); }

    hook.data.isVerified = false;
    hook.data.verifyExpires = Date.now() + (options.delay || defaultVerifyDelay);
    hook.data.verifyToken = buf.toString('hex');

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
  const user = (hook.result || {});

  if (hook.params.provider && user) { // noop if initiated by server
    delete user.verifyExpires;
    delete user.resetExpires;
    if (!ifReturnTokens) {
      delete user.verifyToken;
      delete user.resetToken;
    }
  }
};
