
/* eslint consistent-return: 0, no-param-reassign: 0, no-underscore-dangle: 0,
no-var: 0, vars-on-top: 0 */

const crypto = require('crypto');
const errors = require('feathers-errors');
const auth = require('feathers-authentication').hooks;
const bcrypt = require('bcryptjs');
const hooks = require('feathers-hooks-common');
const utils = require('feathers-hooks-common/lib/utils');
const debug = require('debug')('verify-reset');

var options = {
  userNotifier: (p1, p2, p3, p4, cb) => { cb(null); },
  longTokenLen: 15, // token's length will be twice this
  shortTokenLen: 6,
  shortTokenDigits: true,
  resetDelay: 1000 * 60 * 60 * 2, // 2 hours
  delay: 1000 * 60 * 60 * 24 * 5, // 5 days
  userPropsForShortToken: ['email']
};

/**
 * Feathers-service-verify-reset service to verify user's email, and to reset forgotten password.
 *
 * @param {Object?} options1 - for service
 *
 * options1.userNotifier - function(action, user, notifierOptions, newEmail, cb)
 *    action          type of notification
 *      resend          resendVerifySignup API call
 *      verify          verifySignupLong and verifySignupShort API calls
 *      forgot          sendResetPwd API call
 *      reset           resetPwdLong and resetPwdShort API calls
 *      password        passwordChange API call
 *      email           emailChange API call
 *    user            user's information.
 *    notifierOptions notifierOptions option from resendVerifySignup and sendResetPwd API calls
 *    newEmail        the new email address from emailChange API call
 *
 *    The userNotifier needs to handle the resend and forgot actions at a minimum.
 *
 * options1.longTokenLen
 *    - Half the length of the long token. Default is 15, giving 30-char tokens.
 * options1.shortTokenLen
 *    - Length of short token. Default is 6.
 * options1.shortTokenDigits
 *    - Short token is digits if true, else alphanumeric. Default is true.
 * options1.delay
 *    - Duration for sign up email verification token in ms. Default is 5 days.
 * options1.resetDelay
 *    - Duration for password reset token in ms. Default is 2 hours.
 * options1.userPropsForShortToken
 *    - A 6-digit short token is more susceptible to brute force attack than a 30-char token.
 *    Therefore the verifySignupShort and resetPwdShort API calls require the user be identified
 *    using a find-query-like object. To prevent this itself from being an attack vector,
 *    userPropsForShortToken is an array of valid properties allowed in that query object.
 *    The default is ['email']. You may change it to ['email', 'username'] if you want to
 *    identify users by {email} or {username} or {email, username}.
 *
 * @returns {Function} Featherjs service
 *
 * (A) SERVICE
 * The service creates and maintains the following properties in the user item:
 *    isVerified        if the user's email addr has been verified (boolean)
 *    verifyToken       the 30-char token generated for email addr verification (string)
 *    verifyTokenShort  the 6-digit token generated for email addr verification (string)
 *    verifyExpires     when the email addr token expire (Date)
 *    resetToken        the 30-char token generated for forgotten password reset (string)
 *    resetTokenShort   the 6-digit token generated for forgotten password reset (string)
 *    resetExpires      when the forgotten password token expire (Date)
 *
 * The service is configured on the server with
 * app.configure(authentication)
 *   .configure(verifyReset({ userNotifier }))
 *   .configure(user);
 *
 * It may be called on the client using
 * - (A1) Feathers method calls,
 * - (A2) provided service wrappers,
 * - (A3) HTTP fetch **(docs todo)**
 * - (A4) Redux action creators
 *
 * **(A1) USING FEATHERS' METHOD CALLS**
 * Method calls return a Promise unless a callback is provided.
 *
 * const verifyReset = app.service('/verifyReset/:action/:value');
 * verifyReset.create({ action, value, ... [, cb]});
 *
 * // check props are unique in the users items
 * verifyReset.create({ action: 'checkUnique',
 *   value: uniques, // e.g. {email, username}
 *   ownId, // excludes your current user from the search
 *   meta: { noErrMsg }, // if return an error.message if not unique
 * }, {}, cb)
 *
 * // resend email verification notification
 * verifyReset.create({ action: 'resendVerify',
 *   value: emailOrToken, // email, {email}, {token}
 *   notifierOptions: {}, // options passed to options1.userNotifier, e.g. {transport: 'sms'}
 * }, {}, cb)
 *
 * // email addr verification with long token
 * verifyReset.create({ action: 'verifySignupLong',
 *   value: token, // compares to .verifyToken
 * }, {}, cb)
 *
 * // email addr verification with short token
 * verifyReset.create({ action: 'verifySignupLong',
 *   value: {
 *     token, // compares to .verifyTokenShort
 *     user: {} // identify user, e.g. {email: 'a@a.com'}. See options1.userPropsForShortToken.
 *   }
 * }, {}, cb)
 *
 * // send forgotten password notification
 * verifyReset.create({ action: 'sendResetPwd',
 *   value: email,
 *   notifierOptions: {}, // options passed to options1.userNotifier, e.g. {transport: 'sms'}
 * }, {}, cb)
 *
 * // forgotten password verification with long token
 * verifyReset.create({ action: 'resetPwdLong',
 *   value: {
 *     token, // compares to .resetToken
 *     password, // new password
 *   },
 * }, {}, cb)
 *
 * // forgotten password verification with short token
 * verifyReset.create({ action: 'resetPwdLong',
 *   value: {
 *     token, // compares to .resetTokenShort
 *     password, // new password
 *     user: {} // identify user, e.g. {email: 'a@a.com'}. See options1.userPropsForShortToken.
 *   },
 * }, {}, cb)
 *
 * // change password
 * verifyReset.create({ action: 'passwordChange',
 *   value: {
 *     oldPassword, // old password for verification
 *     password, // new password
 *   },
 * }, { user }, cb)
 *
 * // change email
 * verifyReset.create({ action: 'emailChange',
 *   value: {
 *     password, // current password for verification
 *     email, // new email
 *   },
 * }, { user }, cb)
 *
 *
 * **(A2) PROVIDED SERVICE WRAPPERS**
 * The wrappers return a Promise unless a callback is provided.
 *
 * import VerifyRest from 'feathers-service-verify-reset/lib/client';
 * const app = feathers() ...
 * const verifyReset = new VerifyReset(app);
 *
 * // check props are unique in the users items
 * verifyReset.checkUnique = (uniques, ownId, ifErrMsg, cb)
 *
 * // resend email verification notification
 * verifyReset.resendVerify = (emailOrToken, cb)
 *
 * // email addr verification with long token
 * verifyReset.verifySignupLong = (token, cb)
 *
 * // email addr verification with short token
 * verifyReset.verifySignupShort = (token, userFind, cb)
 *
 * // send forgotten password notification
 * verifyReset.sendResetPwd = (email, cb)
 *
 * // forgotten password verification with long token
 * verifyReset.resetPwdLong = (token, password, cb)
 *
 * // forgotten password verification with short token
 * verifyReset.resetPwdShort = (token, userFind, password, cb)
 *
 * // change password
 * verifyReset.passwordChange = (oldPassword, password, user, cb)
 *
 * // change email
 * verifyReset.emailChange = (password, email, user, cb)
 *
 *
 * **(A3) HTTP FETCH (docs todo)**
 *
 *
 * **(A4) REDUX ACTION CREATORS**
 * See feathers-reduxify-services for information about state, etc.
 *
 * import feathers from 'feathers-client';
 * import reduxifyServices, { getServicesStatus } from 'feathers-reduxify-services';
 * const app = feathers().configure(feathers.socketio(socket)).configure(feathers.hooks());
 * const services = reduxifyServices(app, ['users', 'verifyReset', ...]);
 * ...
 * // hook up Redux reducers
 * export default combineReducers({
 *   users: services.users.reducer,
 *   messages: services.messages.reducer,
 * });
 * ...
 * // Feathers is now 100% compatible with Redux. Use just like (1).
 * store.dispatch(services.verifyReset.create({ action: 'verifySignupLong',
 *     value: token, // compares to .verifyToken
 *   }, {})
 * );
 *
 * (B) HOOKS
 * This service itself does not handle creation of a new user account nor the sending of the initial
 * email verification request.
 * Instead hooks are provided for you to use with the 'users' service 'create' method.
 *
 * const verifyHooks = require('feathers-service-verify-reset').verifyResetHooks;
 * export.before = {
 *   create: [
 *     auth.hashPassword(),
 *     verifyHooks.addVerification() // adds .isVerified, .verifyExpires, .verifyToken props
 *   ]
 * };
 * export.after = {
 *   create: [
 *     hooks.remove('password'),
 *     aHookToEmailYourVerification(),
 *     verifyHooks.removeVerification() // removes verification/reset fields other than .isVerified
 *   ]
 * };
 *
 *
 * A hook is provided to ensure the user's email addr is verified:
 *
 * const auth = require('feathers-authentication').hooks;
 * const verify = require('feathers-service-verify-reset').hooks;
 * export.before = {
 *   create: [
 *     auth.verifyToken(),
 *     auth.populateUser(),
 *     auth.restrictToAuthenticated(),
 *     verify.restrictToVerified()
 *   ]
 * };
 *
 *
 * (C) CONFIGURABLE:
 * The length of the "30-char" token is configurable.
 * The length of the "6-digit" token is configurable. It may also be configured as alphanumeric.
 *
 * (D) 100% BACKWARDS COMPATIBILITY:
 * The following are deprecated and will be removed in the future.
 * options1
 *   emailer    uses options1.userNotifier
 * action
 *   unique     uses checkUnique
 *   resend     uses resendVerify
 *   verify     uses verifySignupLong
 *   forgot     uses sendResetPwd
 *   reset      uses resetPwdLong
 *   password   uses passwordChange
 *   email      uses emailChange
 *
 */
module.exports.service = function (options1 = {}) {
  debug(`service configured.`);

  options = Object.assign(options, options1,
    options1.emailer ? { userNotifier: options1.emailer } : {});

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
        debug(`service called. action=${data.action}`);
        var promise;
        
        users = app.service('/users'); // here in case users service is configured after verifyReset
        params = params1;

        switch (data.action) {
          case 'unique': // backwards compatible, fall through
          case 'checkUnique':
            promise = checkUniqueness(data.value, data.ownId || null, data.meta || {});
            break;
          case 'resend': // backwards compatible, fall through
          case 'resendVerify':
            promise = resendVerifySignup(data.value, data.notifierOptions);
            break;
          case 'verify': // backwards compatible, fall through
          case 'verifySignupLong':
            promise = verifySignupWithLongToken(data.value);
            break;
          case 'verifySignupShort':
            promise = verifySignupWithShortToken(data.value.token, data.value.user);
            break;
          case 'forgot': // backwards compatible, fall through
          case 'sendResetPwd':
            promise = sendResetPwd(data.value, data.notifierOptions);
            break;
          case 'reset': // backwards compatible, fall through
          case 'resetPwdLong':
            promise = resetPwdWithLongToken(data.value.token, data.value.password);
            break;
          case 'resetPwdShort':
            promise = resetPwdWithShortToken(data.value.token, data.value.user, data.value.password);
            break;
          case 'password': // backwards compatible, fall through
          case 'passwordChange':
            promise = passwordChange(params.user, data.value.oldPassword, data.value.password);
            break;
          case 'email': // backwards compatible, fall through
          case 'emailChange':
            promise = emailChange(params.user, data.value.password, data.value.email);
            break;
          default:
            promise = Promise.reject(new errors.BadRequest(`Action '${data.action}' is invalid.`,
                { errors: { $className: 'badParams' } }));
        }
  
        if (cb) {
          promiseToCallback(promise)(cb);
        }
  
        return cb ? promise.catch(() => {}) : promise;
      },
    });

    function checkUniqueness(uniques, ownId, meta) {
      const keys = Object.keys(uniques).filter(
        key => uniques[key] !== undefined && uniques[key] !== null);

      return Promise.all(
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
    }

    // email, {email}, {verifyToken}, {verifyShortToken},
    // {email, verifyToken, verifyShortToken}
    function resendVerifySignup(emailOrToken, notifierOptions) {
      debug('resendVerifySignup', emailOrToken);

      return Promise.resolve()
        .then(() => {
          if (typeof emailOrToken === 'string') { // backwards compatibility
            return { email: emailOrToken };
          }

          ensureObjPropsValid(emailOrToken, ['email', 'verifyToken', 'verifyShortToken']);

          return emailOrToken;
        })
        .then(query => {
          return Promise.all([
            users.find({ query })
              .then(data => getUserData(data, ['isNotVerified'])),
            getLongToken(options.longTokenLen),
            getShortToken(options.shortTokenLen, options.shortTokenDigits)
          ])
        })
        .then(([user, longToken, shortToken]) =>
          patchUser(user, {
            isVerified: false,
            verifyExpires: Date.now() + options.delay,
            verifyToken: longToken,
            verifyShortToken: shortToken,
          })
        )
        .then(user => userNotifier('resend', user, notifierOptions))
        .then(user => sanitizeUserForClient(user));
    }
  
    function verifySignupWithLongToken(verifyToken) {
      return Promise.resolve()
        .then(() => {
          ensureValuesAreStrings(verifyToken);
        
          return verifySignup({ verifyToken }, { verifyToken });
        });
    }
  
    function verifySignupWithShortToken(verifyShortToken, findUser) {
      return Promise.resolve()
        .then(() => {
          ensureValuesAreStrings(verifyShortToken);
          ensureObjPropsValid(findUser, options.userPropsForShortToken);
        
          return verifySignup(findUser, { verifyShortToken });
        });
    }
  
    function verifySignup(query, tokens) {
      return users.find({ query })
        .then(data => getUserData(data, ['isNotVerified', 'verifyNotExpired']))
        .then(user => {
          if (!Object.keys(tokens).every(key => tokens[key] === user[key])) {
            return patchUser(user, {
              verifyToken: null,
              verifyShortToken: null,
              verifyExpires: null,
            })
              .then(() => {
                throw new errors.BadRequest('Invalid token. Get for a new one. (verify-reset)',
                  { errors: { $className: 'badParam' } });
              });
          }
        
          return patchUser(user, {
            isVerified: user.verifyExpires > Date.now(),
            verifyToken: null,
            verifyShortToken: null,
            verifyExpires: null,
          })
            .then(user => userNotifier('verify', user))
            .then(user => sanitizeUserForClient(user));
        });
    }

    function sendResetPwd(email, notifierOptions) {
      debug('sendResetPwd');

      return Promise.resolve()
        .then(() => {
          ensureValuesAreStrings(email);

          return Promise.all([
            users.find({ query: { email } })
              .then(data => getUserData(data, ['isVerified'])),
            getLongToken(options.longTokenLen),
            getShortToken(options.shortTokenLen, options.shortTokenDigits)
          ]);
        })
        .then(([user, longToken, shortToken]) => {
            return patchUser(user, {
              resetExpires: Date.now() + options.resetDelay,
              resetToken: longToken,
              resetShortToken: shortToken,
            })
          }
        )
        .then(user => userNotifier('forgot', user, notifierOptions))
        .then(user => sanitizeUserForClient(user));
    }

    function resetPwdWithLongToken(resetToken, password) {
      return Promise.resolve()
        .then(() => {
          ensureValuesAreStrings(resetToken, password);

          return resetPassword({ resetToken }, { resetToken }, password);
        });
    }

    function resetPwdWithShortToken(resetShortToken, findUser, password) {
      return Promise.resolve()
        .then(() => {
          ensureValuesAreStrings(resetShortToken, password);
          ensureObjPropsValid(findUser, options.userPropsForShortToken);

          return resetPassword(findUser, { resetShortToken }, password);
        });
    }

    function resetPassword(query, tokens, password) {
      return Promise.all([
          users.find({ query })
            .then(data => getUserData(data, ['isVerified', 'resetNotExpired'])),
          hashPassword(app, password),
        ])
        .then(([user, hashedPassword]) => {
          if (!Object.keys(tokens).every(key => tokens[key] === user[key])) {
            return patchUser(user, {
              resetToken: null,
              resetShortToken: null,
              resetExpires: null,
            })
              .then(() => {
                throw new errors.BadRequest('Invalid token. Get for a new one. (verify-reset)',
                  { errors: { $className: 'badParam' } });
              });
          }

          return patchUser(user, {
            password: hashedPassword,
            resetToken: null,
            resetShortToken: null,
            resetExpires: null,
          })
            .then(user => userNotifier('reset', user))
            .then(user => sanitizeUserForClient(user));
        });
    }

    function passwordChange(user, oldPassword, password) {
      debug('passwordChange', oldPassword, password);

      return Promise.resolve()
        .then(() => {
          ensureValuesAreStrings(oldPassword, password);

          return users.find({ query: { email: user.email } })
            .then(data => (Array.isArray(data) ? data[0] : data.data[0]))
        })
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
        .then(user1 => userNotifier('password', user1))
        .then(user1 => sanitizeUserForClient(user1));
    }

    function emailChange(user, password, email) {
      // note this call does not update the authenticated user info in hooks.params.user.
      debug('emailChange', password, email);
      const idType = user._id ? '_id' : 'id';

      return Promise.resolve()
        .then(() => {
          ensureValuesAreStrings(password, email);

          return users.find({ query: { [idType]: user[idType] } })
            .then(data => (Array.isArray(data) ? data[0] : data.data[0]))
        })

        .then(user1 => Promise.all([
          user1,
          comparePasswords(password, user1.password,
            () => new errors.BadRequest('Password is incorrect.',
              { errors: { password: 'Password is incorrect.', $className: 'badParams' } })
          ),
        ]))
        .then(([user1]) => userNotifier('email', user1, null, email)) // value from comparePassword not need
        .then(user1 => patchUser(user1, { email }))
        .then(user1 => sanitizeUserForClient(user1));
    }

    // Helpers requiring this closure

    function patchUser(user, patchToUser) {
      return users.patch(user.id || user._id, patchToUser, {}) // needs users from closure
        .then(() => Object.assign(user, patchToUser));
    }
  };
};

// Hooks

module.exports.hooks = {};

module.exports.hooks.addVerification = (options1) => (hook) => {
  utils.checkContext(hook, 'before', 'create');

  const ourOptions = Object.assign({}, options, options1);
  if (options1 && options1.len) {
    ourOptions.longTokenLen = options1.len; // backward compatibility
  }

  return Promise.all([
    getLongToken(ourOptions.longTokenLen),
    getShortToken(ourOptions.shortTokenLen, ourOptions.shortTokenDigits)
  ])
    .then(([longToken, shortToken]) => {
      hook.data.isVerified = false;
      hook.data.verifyExpires = Date.now() + ourOptions.delay;
      hook.data.verifyToken = longToken;
      hook.data.verifyShortToken = shortToken;

      return hook;
    })
    .catch(err => { throw new errors.GeneralError(err); });
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
      delete user.verifyShortToken;
      delete user.resetToken;
      delete user.resetShortToken;
    }
  }
};

// Helpers

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

function getLongToken(len) {
  return randomBytes(len || options.longTokenLen);
}

function getShortToken(len, ifDigits) {
  len = len || options.shortTokenLen;

  if (ifDigits) {
    return Promise.resolve(randomDigits(len));
  }

  return randomBytes(Math.floor(len / 2) + 1)
    .then(str => {
      str = str.substr(0, len);

      if (str.match(/^[0-9]+$/)) { // tests will fail on all digits
        str = 'q' + str.substr(1); // shhhh, secret.
      }

      return str;
    });
}

function randomBytes(len) {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(len, (err, buf) => (err ? reject(err) : resolve(buf.toString('hex'))));
  });
}
module.exports.randomBytes = (...args) => randomBytes(...args); // made safe for testing

function randomDigits(len) {
  const str = Math.random().toString() + Array(len + 1).join('0');
  return str.substr(2, len);
}
module.exports.randomDigits = (...args) => randomDigits(...args); // made safe for testing

function getUserData(data, checks) {
  if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
    throw new errors.BadRequest('User not found.', { errors: { $className: 'badParams' } });
  }
  
  const users = Array.isArray(data) ? data : data.data;
  const user = users[0];
  
  if (users.length !== 1) {
    throw new errors.BadRequest('More than 1 user selected.',
      { errors: { $className: 'badParams' } });
  }

  if (checks.indexOf('isNotVerified') !== -1 && user.isVerified) {
    throw new errors.BadRequest('User is already verified.',
      { errors: { $className: 'isNotVerified' } });
  }

  if (checks.indexOf('isVerified') !== -1 && !user.isVerified) {
    throw new errors.BadRequest('User is not verified.',
      { errors: { $className: 'isVerified' } });
  }
  
  if (checks.indexOf('verifyNotExpired') !== -1 && user.verifyExpires < Date.now()) {
    throw new errors.BadRequest('Verification token has expired.',
      { errors: { $className: 'verifyExpired' } });
  }

  if (checks.indexOf('resetNotExpired') !== -1 && user.resetExpires < Date.now()) {
    throw new errors.BadRequest('Password reset token has expired.',
      { errors: { $className: 'resetExpired' } });
  }

  return user;
}

function userNotifier(type, user, notifierOptions, newEmail) {
  debug('userNotifier', type);
  const user1 = Object.assign({}, user, newEmail ? { newEmail } : {});
  
  return new Promise((resolve, reject) => {
    options.userNotifier(
      type, sanitizeUserForEmail(user1), notifierOptions || {}, newEmail || '', err2 => {
        debug(`${type}. Completed.`);
        return err2 ? reject(err2) : resolve(user);
      });
  });
}

function ensureObjPropsValid(obj, props, allowNone) {
  const keys = Object.keys(obj);
  const valid = keys.every(key => props.indexOf(key) !== -1 && typeof obj[key] === 'string');
  if (!valid || (keys.length === 0 && !allowNone)) {
    throw new errors.BadRequest(
      'User info is not valid. (verify-reset)', { errors: { $className: 'badParams' } }
    );
  }
}

function ensureValuesAreStrings(...rest) {
  if (!rest.every(str => typeof str === 'string')) {
    throw new errors.BadRequest(
      'Expected string value. (verify-reset)', { errors: { $className: 'badParams' } }
    );
  }
}

function sanitizeUserForClient(user) {
  const user1 = Object.assign({}, user);

  delete user1.password;
  delete user1.verifyExpires;
  delete user1.verifyToken;
  delete user1.verifyShortToken;
  delete user1.resetExpires;
  delete user1.resetToken;
  delete user1.resetShortToken;

  return user1;
}

function sanitizeUserForEmail(user) {
  const user1 = Object.assign({}, user);
  delete user1.password;
  return user1;
}

function promiseToCallback(promise) {
  return function (cb) {
    promise.then(
      data => {
        process.nextTick(cb, null, data);
      },
      err => {
        //if (err) console.log('p2c', err);
        process.nextTick(cb, err);
      });

    return null;
  };
}
