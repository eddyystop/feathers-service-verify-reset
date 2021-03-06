'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

/* eslint consistent-return: 0, no-param-reassign: 0, no-underscore-dangle: 0,
no-var: 0, vars-on-top: 0 */

var crypto = require('crypto');
var errors = require('feathers-errors');
var auth = require('feathers-authentication').hooks;
var bcrypt = require('bcryptjs');
var hooks = require('feathers-hooks-common');
var utils = require('feathers-hooks-common/lib/utils');
var debug = require('debug')('verify-reset');

var options = {
  userNotifier: function userNotifier(p1, p2, p3, p4, cb) {
    cb(null);
  },
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
 * options1.userNotifier - function(type, user, notifierOptions, newEmail, cb)
 *    type                    type of notification
 *      'resendVerifySignup'    from resendVerifySignup API call
 *      'verifySignup'          from verifySignupLong and verifySignupShort API calls
 *      'sendResetPwd'          from sendResetPwd API call
 *      'resetPwd'              from resetPwdLong and resetPwdShort API calls
 *      'passwordChange'        from passwordChange API call
 *      'emailChange'           from emailChange API call
 *    user            user's item, minus password.
 *    notifierOptions notifierOptions option from resendVerifySignup and sendResetPwd API calls
 *    newEmail        the new email address from emailChange API call
 *
 *    userNotifier needs to handle at least the resendVerifySignup and sendResetPwd notifications.
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
 * (A) THE SERVICE
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
 * - (A4) React's Redux
 * - (A5) Vue 2.0 **(docs todo)**
 *
 * **(A1) USING FEATHERS' METHOD CALLS**
 * Method calls return a Promise unless a callback is provided.
 *
 * const verifyReset = app.service('/verifyReset/:action/:value');
 * verifyReset.create({ action, value, ... [, cb]});
 *
 * // check props are unique in the users items
 * verifyReset.create({ action: 'checkUnique',
 *   value: uniques, // e.g. {email, username}. Props with null or undefined are ignored.
 *   ownId, // excludes your current user from the search
 *   meta: { noErrMsg }, // if return an error.message if not unique
 * }, {}, cb)
 *
 * // resend email verification notification
 * verifyReset.create({ action: 'resendVerifySignup',
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
 * verifyReset.create({ action: 'verifySignupShort',
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
 * verifyReset.create({ action: 'resetPwdShort',
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
 * // check long token is valid without modifying user item
 * verifyReset.create({ action: 'checkResetLongTokenValid',
 *   value: token,
 * }, {}, cb)
 *
 * // Authenticate user and log on if user is verified.
 * var cbCalled = false;
 * app.authenticate({ type: 'local', email, password })
 *   .then((result) => {
 *     const user = result.data;
 *     if (!user || !user.isVerified) {
 *       app.logout();
 *       cb(new Error(user ? 'User\'s email is not verified.' : 'No user returned.'));
 *       return;
 *     }
 *     cbCalled = true;
 *     cb(null, user);
 *   })
 *   .catch((err) => {
 *     if (!cbCalled) { cb(err); } // ignore throws from .then( cb(null, user) )
 *   });
 *
 *
 * **(A2) PROVIDED SERVICE WRAPPERS**
 * The wrappers return a Promise unless a callback is provided.
 * See example/ for a working example of wrapper usage.
 *
 * <script src=".../feathers-service-verify-reset/lib/client.js"></script>
 *   or
 * import VerifyRest from 'feathers-service-verify-reset/lib/client';
 *
 * const app = feathers() ...
 * const verifyReset = new VerifyReset(app);
 *
 * // check props are unique in the users items
 * verifyReset.checkUnique(uniques, ownId, ifErrMsg, cb)
 *
 * // resend email verification notification
 * verifyReset.resendVerifySignup(emailOrToken, notifierOptions, cb)
 *
 * // email addr verification with long token
 * verifyReset.verifySignupLong(token, cb)
 *
 * // email addr verification with short token
 * verifyReset.verifySignupShort(token, userFind, cb)
 *
 * // send forgotten password notification
 * verifyReset.sendResetPwd(email, notifierOptions, cb)
 *
 * // forgotten password verification with long token
 * verifyReset.resetPwdLong(token, password, cb)
 *
 * // forgotten password verification with short token
 * verifyReset.resetPwdShort(token, userFind, password, cb)
 *
 * // change password
 * verifyReset.passwordChange(oldPassword, password, user, cb)
 *
 * // change email
 * verifyReset.emailChange(password, email, user, cb)
 *
 * // Authenticate user and log on if user is verified.
 * verifyReset.authenticate(email, password, cb)
 *
 *
 * **(A3) HTTP FETCH (docs todo)**
 * // check props are unique in the users items
 * // Set params just like (A1).
 * fetch('/verifyReset/:action/:value', {
 *   method: 'POST', headers: { Accept: 'application/json' },
 *   body: JSON.stringify({ action: 'checkUnique', value: uniques, ownId, meta: { noErrMsg } })
 * })
 *   .then(data => { ... }).catch(err => { ... });
 *
 *
 * **(A4) REACT'S REDUX**
 * See feathers-reduxify-services for information about state, etc.
 * See feathers-starter-react-redux-login-roles for a working example.
 *
 * (A4.1) Dispatching services
 * import feathers from 'feathers-client';
 * import reduxifyServices, { getServicesStatus } from 'feathers-reduxify-services';
 * const app = feathers().configure(feathers.socketio(socket)).configure(feathers.hooks());
 * const services = reduxifyServices(app, ['users', 'verifyReset', ...]);
 * ...
 * // hook up Redux reducers
 * export default combineReducers({
 *   users: services.users.reducer,
 *   verifyReset: services.verifyReset.reducer,
 * });
 * ...
 *
 * // email addr verification with long token
 * // Feathers is now 100% compatible with Redux. Use just like (A1).
 * store.dispatch(services.verifyReset.create({ action: 'verifySignupLong',
 *     value: token, // compares to .verifyToken
 *   }, {})
 * );
 *
 * (A4.2) Dispatching authentication. User must be verified to sign in.
 * const reduxifyAuthentication = require('feathers-reduxify-authentication');
 * const signin = reduxifyAuthentication(app, { isUserAuthorized: (user) => user.isVerified });
 *
 * // Sign in with the JWT currently in localStorage
 * if (localStorage['feathers-jwt']) {
 *   store.dispatch(signin.authenticate()).catch(err => { ... });
 * }
 *
 * // Sign in with credentials
 * store.dispatch(signin.authenticate({ type: 'local', email, password }))
 *   .then(() => { ... )
 *   .catch(err => { ... });
 *
 *
 * **(A5) VUE 2.0 (docs todo)**
 *
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
 * (C) SECURITY
 * - The user must be identified when the short token is used, making the short token less appealing
 * as an attack vector.
 * - The long and short tokens are erased on successful verification and password reset attempts.
 * New tokens must be acquired for another attempt.
 * - API params are verified to be strings. If the param is an object, the values of its props are
 * verified to be strings.
 * - options1.userPropsForShortToken restricts the prop names allowed in param objects.
 *
 * (D) CONFIGURABLE:
 * The length of the "30-char" token is configurable.
 * The length of the "6-digit" token is configurable. It may also be configured as alphanumeric.
 *
 * (E) MIGRATION FROM 0.8.0
 * A few changes are needed to migrate to 1.0.0. Names were standardized throughout the
 * new version and these had to be changed.
 *
 * options1.userNotifier signature
 *   was (type, user1, params, cb)
 *   now (type, user1, notifierOptions, newEmail, cb)
 * options1.userNotifier param 'type'
 *   'resend'   now 'resendVerifySignup'
 *   'verify'   now 'verifySignup'
 *   'forgot'   now 'sendResetPwd'
 *   'reset'    now 'resetPwd'
 *   'password' now 'passwordChange'
 *   'email'    now 'emailChange'
 *
 * Error messages used to return
 *   new errors.BadRequest('Password is incorrect.',
 *     { errors: { password: 'Password is incorrect.' } })
 * This was hacky although convenient if the names matched your UI. Now they return
 *   new errors.BadRequest('Password is incorrect.',
 *     { errors: { password: 'Password is incorrect.', $className: 'badParams' } })
 * or even
 *   new errors.BadRequest('Password is incorrect.',
 *     { errors: { $className: 'badParams' } })
 * Set your local UI errors based on the $className value.
 *
 * The following are deprecated but remain working. They will be removed in the future.
 * options1
 *   emailer    uses options1.userNotifier
 * API param 'action'
 *   'unique'   uses 'checkUnique'
 *   'resend'   uses 'resendVerifySignup'
 *   'verify'   uses 'verifySignupLong'
 *   'forgot'   uses 'sendResetPwd'
 *   'reset'    uses 'resetPwdLong'
 *   'password' uses 'passwordChange'
 *   'email'    uses 'emailChange'
 * client wrapper
 *   .unique            uses .checkUnique
 *   .verifySignUp      uses .verifySignupLong
 *   .sendResetPassword uses .sendResetPwd
 *   .saveResetPassword uses .resetPwdLong
 *   .changePassword    uses .passwordChange
 *   .changeEmail       uses .emailChange
 *
 * The service now uses the route /verifyreset rather than /verifyReset/:action/:value
 *
 */
module.exports.service = function () {
  var options1 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

  debug('service configured.');

  options = Object.assign(options, options1, options1.emailer ? { userNotifier: options1.emailer } : {});

  return function verifyReset() {
    // 'function' needed as we use 'this'
    debug('service initialized');
    var app = this;
    var path = 'verifyReset';
    var users;
    var params;

    var isAction = function isAction() {
      for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      return function (hook) {
        return args.indexOf(hook.data.action) !== -1;
      };
    };

    app.use(path, {
      before: {
        create: [hooks.iff(isAction('password', 'email'), auth.verifyToken()), hooks.iff(isAction('password', 'email'), auth.populateUser())]
      },
      create: function create(data, params1, cb) {
        debug('service called. action=' + data.action);
        var callbackCalled = false;
        var promise;

        users = app.service('/users'); // here in case users service is configured after verifyReset
        params = params1;

        switch (data.action) {
          case 'unique': // backwards compatible, fall through
          case 'checkUnique':
            promise = checkUniqueness(data.value, data.ownId || null, data.meta || {});
            break;
          case 'resend': // backwards compatible, fall through
          case 'resendVerifySignup':
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
          case 'checkResetLongTokenValid':
            promise = checkResetLongTokenValid(data.value);
            break;
          default:
            promise = Promise.reject(new errors.BadRequest('Action \'' + data.action + '\' is invalid.', { errors: { $className: 'badParams' } }));
        }

        if (cb) {
          // Feathers cannot return an error to the client if we use process.nextTick(cb, err)
          promise.then(function (data1) {
            callbackCalled = true;
            cb(null, data1);
          }).catch(function (err) {
            if (!callbackCalled) {
              // don't call cb should cb(null, data) throw
              callbackCalled = true;
              cb(err);
            }
          });
        }

        return promise;
      }
    });

    function checkUniqueness(uniques, ownId, meta) {
      var keys = Object.keys(uniques).filter(function (key) {
        return uniques[key] !== undefined && uniques[key] !== null;
      });

      return Promise.all(keys.map(function (prop) {
        return users.find({ query: _defineProperty({}, prop, uniques[prop].trim()) }).then(function (data) {
          var items = Array.isArray(data) ? data : data.data;
          var isNotUnique = items.length > 1 || items.length === 1 && (items[0].id || items[0]._id) !== ownId;

          return isNotUnique ? prop : null;
        });
      })).catch(function (err) {
        throw new errors.GeneralError(err);
      }).then(function (allProps) {
        var errProps = allProps.filter(function (prop) {
          return prop;
        });

        if (errProps.length) {
          var errs = {};
          errProps.forEach(function (prop) {
            errs[prop] = 'Already taken.';
          });

          throw new errors.BadRequest(meta.noErrMsg ? null : 'Values already taken.', { errors: errs });
        }
      });
    }

    // email, {email}, {verifyToken}, {verifyShortToken},
    // {email, verifyToken, verifyShortToken}
    function resendVerifySignup(emailOrToken, notifierOptions) {
      debug('resendVerifySignup', emailOrToken);

      return Promise.resolve().then(function () {
        if (typeof emailOrToken === 'string') {
          // backwards compatibility
          emailOrToken = { email: emailOrToken };
        }

        ensureObjPropsValid(emailOrToken, ['email', 'verifyToken', 'verifyShortToken']);

        return emailOrToken;
      }).then(function (query) {
        return Promise.all([users.find({ query: query }).then(function (data) {
          return getUserData(data, ['isNotVerified']);
        }), getLongToken(options.longTokenLen), getShortToken(options.shortTokenLen, options.shortTokenDigits)]);
      }).then(function (_ref) {
        var _ref2 = _slicedToArray(_ref, 3),
            user = _ref2[0],
            longToken = _ref2[1],
            shortToken = _ref2[2];

        return patchUser(user, {
          isVerified: false,
          verifyExpires: Date.now() + options.delay,
          verifyToken: longToken,
          verifyShortToken: shortToken
        });
      }).then(function (user) {
        return userNotifier('resendVerifySignup', user, notifierOptions);
      }).then(function (user) {
        return sanitizeUserForClient(user);
      });
    }

    function verifySignupWithLongToken(verifyToken) {
      return Promise.resolve().then(function () {
        ensureValuesAreStrings(verifyToken);

        return verifySignup({ verifyToken: verifyToken }, { verifyToken: verifyToken });
      });
    }

    function verifySignupWithShortToken(verifyShortToken, findUser) {
      return Promise.resolve().then(function () {
        ensureValuesAreStrings(verifyShortToken);
        ensureObjPropsValid(findUser, options.userPropsForShortToken);

        return verifySignup(findUser, { verifyShortToken: verifyShortToken });
      });
    }

    function verifySignup(query, tokens) {
      return users.find({ query: query }).then(function (data) {
        return getUserData(data, ['isNotVerified', 'verifyNotExpired']);
      }).then(function (user) {
        if (!Object.keys(tokens).every(function (key) {
          return tokens[key] === user[key];
        })) {
          return patchUser(user, {
            verifyToken: null,
            verifyShortToken: null,
            verifyExpires: null
          }).then(function () {
            throw new errors.BadRequest('Invalid token. Get for a new one. (verify-reset)', { errors: { $className: 'badParam' } });
          });
        }

        return patchUser(user, {
          isVerified: user.verifyExpires > Date.now(),
          verifyToken: null,
          verifyShortToken: null,
          verifyExpires: null
        }).then(function (user1) {
          return userNotifier('verifySignup', user1);
        }).then(function (user1) {
          return sanitizeUserForClient(user1);
        });
      });
    }

    function sendResetPwd(email, notifierOptions) {
      debug('sendResetPwd');

      return Promise.resolve().then(function () {
        ensureValuesAreStrings(email);

        return Promise.all([users.find({ query: { email: email } }).then(function (data) {
          return getUserData(data, ['isVerified']);
        }), getLongToken(options.longTokenLen), getShortToken(options.shortTokenLen, options.shortTokenDigits)]);
      }).then(function (_ref3) {
        var _ref4 = _slicedToArray(_ref3, 3),
            user = _ref4[0],
            longToken = _ref4[1],
            shortToken = _ref4[2];

        return patchUser(user, {
          resetExpires: Date.now() + options.resetDelay,
          resetToken: longToken,
          resetShortToken: shortToken
        });
      }).then(function (user) {
        return userNotifier('sendResetPwd', user, notifierOptions);
      }).then(function (user) {
        return sanitizeUserForClient(user);
      });
    }

    function resetPwdWithLongToken(resetToken, password) {
      return Promise.resolve().then(function () {
        ensureValuesAreStrings(resetToken, password);

        return resetPassword({ resetToken: resetToken }, { resetToken: resetToken }, password);
      });
    }

    function resetPwdWithShortToken(resetShortToken, findUser, password) {
      return Promise.resolve().then(function () {
        ensureValuesAreStrings(resetShortToken, password);
        ensureObjPropsValid(findUser, options.userPropsForShortToken);

        return resetPassword(findUser, { resetShortToken: resetShortToken }, password);
      });
    }

    function resetPassword(query, tokens, password) {
      return Promise.all([users.find({ query: query }).then(function (data) {
        return getUserData(data, ['isVerified', 'resetNotExpired']);
      }), hashPassword(app, password)]).then(function (_ref5) {
        var _ref6 = _slicedToArray(_ref5, 2),
            user = _ref6[0],
            hashedPassword = _ref6[1];

        if (!Object.keys(tokens).every(function (key) {
          return tokens[key] === user[key];
        })) {
          return patchUser(user, {
            resetToken: null,
            resetShortToken: null,
            resetExpires: null
          }).then(function () {
            throw new errors.BadRequest('Invalid token. Get for a new one. (verify-reset)', { errors: { $className: 'badParam' } });
          });
        }

        return patchUser(user, {
          password: hashedPassword,
          resetToken: null,
          resetShortToken: null,
          resetExpires: null
        }).then(function (user1) {
          return userNotifier('resetPwd', user1);
        }).then(function (user1) {
          return sanitizeUserForClient(user1);
        });
      });
    }

    function passwordChange(user, oldPassword, password) {
      debug('passwordChange', oldPassword, password);

      return Promise.resolve().then(function () {
        ensureValuesAreStrings(oldPassword, password);

        return users.find({ query: { email: user.email } }).then(function (data) {
          return Array.isArray(data) ? data[0] : data.data[0];
        });
      }).then(function (user1) {
        return Promise.all([user1, hashPassword(app, password), comparePasswords(oldPassword, user1.password, function () {
          return new errors.BadRequest('Current password is incorrect.', { errors: { oldPassword: 'Current password is incorrect.' } });
        })]);
      }).then(function (_ref7) {
        var _ref8 = _slicedToArray(_ref7, 2),
            user1 = _ref8[0],
            hashedPassword = _ref8[1];

        return (// value from comparePassword is not needed
          patchUser(user1, {
            password: hashedPassword
          })
        );
      }).then(function (user1) {
        return userNotifier('passwordChange', user1);
      }).then(function (user1) {
        return sanitizeUserForClient(user1);
      });
    }

    function emailChange(user, password, email) {
      // note this call does not update the authenticated user info in hooks.params.user.
      debug('emailChange', password, email);
      var idType = user._id ? '_id' : 'id';

      return Promise.resolve().then(function () {
        ensureValuesAreStrings(password, email);

        return users.find({ query: _defineProperty({}, idType, user[idType]) }).then(function (data) {
          return Array.isArray(data) ? data[0] : data.data[0];
        });
      }).then(function (user1) {
        return Promise.all([user1, comparePasswords(password, user1.password, function () {
          return new errors.BadRequest('Password is incorrect.', { errors: { password: 'Password is incorrect.', $className: 'badParams' } });
        })]);
      }).then(function (_ref9) {
        var _ref10 = _slicedToArray(_ref9, 1),
            user1 = _ref10[0];

        return userNotifier('emailChange', user1, null, email);
      }) // value from comparePassword not need
      .then(function (user1) {
        return patchUser(user1, { email: email });
      }).then(function (user1) {
        return sanitizeUserForClient(user1);
      });
    }

    function checkResetLongTokenValid(resetToken) {
      return Promise.resolve().then(function () {
        ensureValuesAreStrings(resetToken);

        return checkResetTokenValid({ resetToken: resetToken }, { resetToken: resetToken });
      });
    }

    function checkResetTokenValid(query, tokens) {
      return users.find({ query: query }).then(function (data) {
        return getUserData(data, ['isVerified', 'resetNotExpired']);
      }).then(function (user) {
        if (!Object.keys(tokens).every(function (key) {
          return tokens[key] === user[key];
        })) {
          throw new errors.BadRequest('Invalid token. Get for a new one. (verify-reset)', { errors: { $className: 'badParam' } });
        }

        return { valid: true };
      });
    }

    // Helpers requiring this closure

    function patchUser(user, patchToUser) {
      return users.patch(user.id || user._id, patchToUser, {}) // needs users from closure
      .then(function () {
        return Object.assign(user, patchToUser);
      });
    }
  };
};

// Hooks

module.exports.hooks = {};

module.exports.hooks.addVerification = function (options1) {
  return function (hook) {
    utils.checkContext(hook, 'before', 'create');

    var ourOptions = Object.assign({}, options, options1);
    if (options1 && options1.len) {
      ourOptions.longTokenLen = options1.len; // backward compatibility
    }

    return Promise.all([getLongToken(ourOptions.longTokenLen), getShortToken(ourOptions.shortTokenLen, ourOptions.shortTokenDigits)]).then(function (_ref11) {
      var _ref12 = _slicedToArray(_ref11, 2),
          longToken = _ref12[0],
          shortToken = _ref12[1];

      hook.data.isVerified = false;
      hook.data.verifyExpires = Date.now() + ourOptions.delay;
      hook.data.verifyToken = longToken;
      hook.data.verifyShortToken = shortToken;

      return hook;
    }).catch(function (err) {
      throw new errors.GeneralError(err);
    });
  };
};

module.exports.hooks.restrictToVerified = function () {
  return function (hook) {
    utils.checkContext(hook, 'before');

    if (!hook.params.user || !hook.params.user.isVerified) {
      throw new errors.BadRequest('User\'s email is not yet verified.');
    }
  };
};

module.exports.hooks.removeVerification = function (ifReturnTokens) {
  return function (hook) {
    utils.checkContext(hook, 'after');
    var user = hook.result || {};

    if (!('isVerified' in user) && hook.method === 'create') {
      /* eslint-disable no-console */
      console.warn('Property isVerified not found in user properties. (removeVerification)');
      console.warn('Have you added verify-reset\'s properties to your model? (Refer to README.md)');
      console.warn('Have you added the addVerification hook on users::create?');
      /* eslint-enable */
    }

    if (hook.params.provider && user) {
      // noop if initiated by server
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
};

// Helpers

function hashPassword(app1, password) {
  var hook = {
    type: 'before',
    data: { password: password },
    params: { provider: null },
    app: {
      get: function get(str) {
        return app1.get(str);
      }
    }
  };

  return auth.hashPassword()(hook).then(function (hook1) {
    return hook1.data.password;
  });
}

function comparePasswords(oldPassword, password, getError) {
  return new Promise(function (resolve, reject) {
    bcrypt.compare(oldPassword, password, function (err, data1) {
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

  return randomBytes(Math.floor(len / 2) + 1).then(function (str) {
    str = str.substr(0, len);

    if (str.match(/^[0-9]+$/)) {
      // tests will fail on all digits
      str = 'q' + str.substr(1); // shhhh, secret.
    }

    return str;
  });
}

function randomBytes(len) {
  return new Promise(function (resolve, reject) {
    crypto.randomBytes(len, function (err, buf) {
      return err ? reject(err) : resolve(buf.toString('hex'));
    });
  });
}
module.exports.randomBytes = function () {
  return randomBytes.apply(undefined, arguments);
}; // made safe for testing

function randomDigits(len) {
  var str = Math.random().toString() + Array(len + 1).join('0');
  return str.substr(2, len);
}
module.exports.randomDigits = function () {
  return randomDigits.apply(undefined, arguments);
}; // made safe for testing

function getUserData(data, checks) {
  if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
    throw new errors.BadRequest('User not found.', { errors: { $className: 'badParams' } });
  }

  var users = Array.isArray(data) ? data : data.data;
  var user = users[0];

  if (users.length !== 1) {
    throw new errors.BadRequest('More than 1 user selected.', { errors: { $className: 'badParams' } });
  }

  if (checks.indexOf('isNotVerified') !== -1 && user.isVerified) {
    throw new errors.BadRequest('User is already verified.', { errors: { $className: 'isNotVerified' } });
  }

  if (checks.indexOf('isVerified') !== -1 && !user.isVerified) {
    throw new errors.BadRequest('User is not verified.', { errors: { $className: 'isVerified' } });
  }

  if (checks.indexOf('verifyNotExpired') !== -1 && user.verifyExpires < Date.now()) {
    throw new errors.BadRequest('Verification token has expired.', { errors: { $className: 'verifyExpired' } });
  }

  if (checks.indexOf('resetNotExpired') !== -1 && user.resetExpires < Date.now()) {
    throw new errors.BadRequest('Password reset token has expired.', { errors: { $className: 'resetExpired' } });
  }

  return user;
}

function userNotifier(type, user, notifierOptions, newEmail) {
  debug('userNotifier', type);
  var user1 = Object.assign({}, user, newEmail ? { newEmail: newEmail } : {});

  return new Promise(function (resolve, reject) {
    options.userNotifier(type, sanitizeUserForEmail(user1), notifierOptions || {}, newEmail || '', function (err2) {
      debug(type + '. Completed.');
      return err2 ? reject(err2) : resolve(user);
    });
  });
}

function ensureObjPropsValid(obj, props, allowNone) {
  var keys = Object.keys(obj);
  var valid = keys.every(function (key) {
    return props.indexOf(key) !== -1 && typeof obj[key] === 'string';
  });
  if (!valid || keys.length === 0 && !allowNone) {
    throw new errors.BadRequest('User info is not valid. (verify-reset)', { errors: { $className: 'badParams' } });
  }
}

function ensureValuesAreStrings() {
  for (var _len2 = arguments.length, rest = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
    rest[_key2] = arguments[_key2];
  }

  if (!rest.every(function (str) {
    return typeof str === 'string';
  })) {
    throw new errors.BadRequest('Expected string value. (verify-reset)', { errors: { $className: 'badParams' } });
  }
}

function sanitizeUserForClient(user) {
  var user1 = Object.assign({}, user);

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
  var user1 = Object.assign({}, user);
  delete user1.password;
  return user1;
}