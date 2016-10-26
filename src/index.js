
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
            return checkUniqueness(data.value, data.ownId || null, data.meta || {}, cb);
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

    function checkUniqueness(uniques, ownId, meta, cb) {
      const keys = Object.keys(uniques).filter(
        key => uniques[key] !== undefined && uniques[key] !== null);

      const promise = Promise.all(
        keys.map(prop => users.find({ query: { [prop]: uniques[prop].trim() } })
          .then(data => {
            const items = Array.isArray(data) ? data : data.data;
            const isNotUnique = items.length > 1
              || (items.length === 1 && (items[0].id || items[0]._id) !== ownId);

            return isNotUnique ? prop : null;
          })
        ))
        .catch(err => {
          throw new errors.GeneralError(err);
        })
        .then(allProps => {
          const errProps = allProps.filter(prop => prop);

          if (errProps.length) {
            const errs = {};
            errProps.forEach(prop => { errs[prop] = 'Already taken.'; });

            throw new errors.BadRequest(meta.noErrMsg ? null : 'Values already taken.',
              { errors: errs }
            );
          }
        });

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function resendVerifySignUp(emailOrToken, cb) {
      debug('resend', emailOrToken);
      var query = {};

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

      const findUser = query1 => users.find({ query: query1 })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            throw new errors.BadRequest('Email or verify token not found.',
              { errors: { email: 'Not found.', token: 'Not found.' } }
            );
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (user.isVerified) {
            throw new errors.BadRequest('User is already verified.',
              { errors: { email: 'User is already verified.', token: 'User is already verified.' } }
            );
          }

          return user;
        });

      const promise = Promise.all([
        findUser(query),
        randomBytes(options.len || 15),
      ])
        .then(([user, randomStr]) =>
          patchUser(user, {
            isVerified: false,
            verifyExpires: Date.now() + defaultVerifyDelay,
            verifyToken: randomStr,
          })
        )
        .then(user => sendEmail('resend', user))
        .then(user => sanitizeUserForClient(user));

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function verifySignUp(token, cb) {
      debug(`verify ${token}`);

      const findUser = () => users.find({ query: { verifyToken: token } })
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

          return user;
        });

      const promise = findUser()
        .then(user => {
          const patchToUser = {
            isVerified: user.verifyExpires > Date.now(),
            verifyExpires: null,
            verifyToken: null,
          };

          if ('resetToken' in user) { patchToUser.resetToken = null; }
          if ('resetExpires' in user) { patchToUser.resetExpires = null; }

          if (!patchToUser.isVerified) {
            throw new errors.BadRequest(
              'Verification token has expired.',
              { errors: { $className: 'expired' } }
            );
          }

          return patchUser(user, patchToUser);
        })
        .then(user => sendEmail('verify', user))
        .then(user => sanitizeUserForClient(user));

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function sendResetPwd(email, cb) {
      debug('forgot');

      const findUser = () => users.find({ query: { email } })
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

          return user;
        });

      const promise = Promise.all([
        findUser(),
        randomBytes(options.len || 15),
      ])
        .then(([user, randomStr]) =>
          patchUser(user, {
            resetExpires: Date.now() + resetDelay,
            resetToken: randomStr,
          })
        )
        .then(user => sendEmail('forgot', user))
        .then(user => sanitizeUserForClient(user));

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function resetPwd(token, password, cb) {
      debug('reset', token, password);

      const findUser = () => users.find({ query: { resetToken: token } })
        .then(data => {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            throw new errors.BadRequest(
              'Reset token not found.', { errors: { $className: 'notFound' } }
            );
          }

          const user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (!user.isVerified) {
            throw new errors.BadRequest(
              'Email is not verified.', { errors: { $className: 'notVerified' } }
            );
          }
          if (user.resetExpires < Date.now()) {
            throw new errors.BadRequest(
              'Reset token has expired.', { errors: { $className: 'expired' } }
            );
          }

          return user;
        });

      const promise = Promise.all([
        findUser(),
        hashPassword(app, password),
      ])
        .then(([user, hashedPassword]) =>
          patchUser(user, {
            password: hashedPassword,
            resetToken: null,
            resetExpires: null,
          })
        )
        .then(user => sendEmail('reset', user))
        .then(user => sanitizeUserForClient(user));

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function passwordChange(user, oldPassword, password, cb) {
      debug('password', oldPassword, password);

      const findUser = () => users.find({ query: { email: user.email } })
        .then(data => (Array.isArray(data) ? data[0] : data.data[0])); // email is unique

      const promise = findUser()
        .then(user1 => Promise.all([
          user1,
          hashPassword(app, password),
          comparePasswords(oldPassword, user1.password,
            () => new errors.BadRequest('Current password is incorrect.',
              { errors: { oldPassword: 'Current password is incorrect.' } })
          ),
        ]))
        .then(([user1, hashedPassword]) => // value from comparePassword is not needed
          patchUser(user1, {
            password: hashedPassword,
          })
        )
        .then(user1 => sendEmail('password', user1))
        .then(user1 => sanitizeUserForClient(user1));

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function emailChange(user, password, email, cb) {
      // note this call does not update the authenticated user info in hooks.params.user.
      debug('email', password, email);

      const findUser = () => {
        const idType = user._id ? '_id' : 'id';
        return users.find({ query: { [idType]: user[idType] } })
          .then(data => (Array.isArray(data) ? data[0] : data.data[0])); // id is unique
      };

      const promise = findUser()
        .then(user1 => Promise.all([
          user1,
          comparePasswords(password, user1.password,
            () => new errors.BadRequest('Password is incorrect.',
              { errors: { password: 'Password is incorrect.' } })
          ),
        ]))
        .then(([user1]) => sendEmail('email', user1, email)) // value from comparePassword not need
        .then(user1 => patchUser(user1, { email }))
        .then(user1 => sanitizeUserForClient(user1));

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    // Helpers

    function randomBytes(len) {
      return new Promise((resolve, reject) => {
        crypto.randomBytes(len, (err, buf) => (err ? reject(err) : resolve(buf.toString('hex'))));
      });
    }

    function hashPassword(app1, password) {
      const hook = {
        type: 'before',
        data: { password },
        params: { provider: null },
        app: {
          get(str) {
            return app1.get(str);
          },
        },
      };

      return auth.hashPassword()(hook)
        .then(hook1 => hook1.data.password);
    }

    function comparePasswords(oldPassword, password, getError) {
      return new Promise((resolve, reject) => {
        bcrypt.compare(oldPassword, password, (err, data1) => {
          if (err || !data1) {
            return reject(getError());
          }

          return resolve();
        });
      });
    }

    function patchUser(user /* modified */, patchToUser) {
      return users.patch(user.id || user._id, patchToUser, {})
        .then(() => Object.assign(user, patchToUser));
    }

    function sendEmail(emailAction, user, email) {
      const user1 = Object.assign({}, user, email ? { newEmail: email } : {});

      return new Promise((resolve, reject) => {
        emailer(emailAction, sanitizeUserForEmail(user1), params, err2 => {
          debug(`${emailAction}. Completed.`);
          return err2 ? reject(err2) : resolve(user);
        });
      });
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

        return null;
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

  if (!('isVerified' in user) && hook.method === 'create') {
    /* eslint-disable no-console */
    console.warn('Property isVerified not found in user properties. (removeVerification)');
    console.warn('Have you added verify-reset\'s properties to your model? (Refer to README.md)');
    console.warn('Have you added the addVerification hook on users::create?');
    /* eslint-enable */
  }

  if (hook.params.provider && user) { // noop if initiated by server
    delete user.verifyExpires;
    delete user.resetExpires;
    if (!ifReturnTokens) {
      delete user.verifyToken;
      delete user.resetToken;
    }
  }
};
