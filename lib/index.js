'use strict';

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

/* eslint consistent-return: 0, no-param-reassign: 0, no-underscore-dangle: 0,
no-var: 0, vars-on-top: 0 */

var crypto = require('crypto');
var errors = require('feathers-errors');
var auth = require('feathers-authentication').hooks;
var bcrypt = require('bcryptjs');
var hooks = require('feathers-hooks-common');
var utils = require('feathers-hooks-common/lib/utils');
var debug = require('debug')('verifyReset');

var defaultVerifyDelay = 1000 * 60 * 60 * 24 * 5; // 5 days
var defaultResetDelay = 1000 * 60 * 60 * 2; // 2 hours

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
  debug('service configured. typeof emailer=' + _typeof(options.emailer));

  var emailer = options.emailer || function (p1, p2, p3, cb) {
    cb(null);
  };
  var resetDelay = options.resetDelay || defaultResetDelay;

  return function verifyReset() {
    // 'function' needed as we use 'this'
    debug('service initialized');
    var app = this;
    var path = '/verifyReset/:action/:value';
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
        debug('service called. action=' + data.action + ' value=' + JSON.stringify(data.value));
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
            throw new errors.BadRequest('Action "' + data.action + '" is invalid.');
        }
      }
    });

    function checkUniqueness(uniques, ownId, meta, cb) {
      var keys = Object.keys(uniques).filter(function (key) {
        return uniques[key] !== undefined && uniques[key] !== null;
      });

      var promise = Promise.all(keys.map(function (prop) {
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
          (function () {
            var errs = {};
            errProps.forEach(function (prop) {
              errs[prop] = 'Already taken.';
            });

            throw new errors.BadRequest(meta.noErrMsg ? null : 'Values already taken.', { errors: errs });
          })();
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

      var findUser = function findUser(query1) {
        return users.find({ query: query1 }).then(function (data) {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            throw new errors.BadRequest('Email or verify token not found.', { errors: { email: 'Not found.', token: 'Not found.' } });
          }

          var user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (user.isVerified) {
            throw new errors.BadRequest('User is already verified.', { errors: { email: 'User is already verified.', token: 'User is already verified.' } });
          }

          return user;
        });
      };

      var promise = Promise.all([findUser(query), randomBytes(options.len || 15)]).then(function (_ref) {
        var _ref2 = _slicedToArray(_ref, 2),
            user = _ref2[0],
            randomStr = _ref2[1];

        return patchUser(user, {
          isVerified: false,
          verifyExpires: Date.now() + defaultVerifyDelay,
          verifyToken: randomStr
        });
      }).then(function (user) {
        return sendEmail('resend', user);
      }).then(function (user) {
        return sanitizeUserForClient(user);
      });

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function verifySignUp(token, cb) {
      debug('verify ' + token);

      var findUser = function findUser() {
        return users.find({ query: { verifyToken: token } }).then(function (data) {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest('Verification token was not issued.', { errors: { $className: 'notIssued' } }));
          }

          var user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (user.isVerified) {
            return cb(new errors.BadRequest('User is already verified.', { errors: { $className: 'alreadyVerified' } }));
          }

          return user;
        });
      };

      var promise = findUser().then(function (user) {
        var patchToUser = {
          isVerified: user.verifyExpires > Date.now(),
          verifyExpires: null,
          verifyToken: null
        };

        if ('resetToken' in user) {
          patchToUser.resetToken = null;
        }
        if ('resetExpires' in user) {
          patchToUser.resetExpires = null;
        }

        if (!patchToUser.isVerified) {
          throw new errors.BadRequest('Verification token has expired.', { errors: { $className: 'expired' } });
        }

        return patchUser(user, patchToUser);
      }).then(function (user) {
        return sendEmail('verify', user);
      }).then(function (user) {
        return sanitizeUserForClient(user);
      });

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function sendResetPwd(email, cb) {
      debug('forgot');

      var findUser = function findUser() {
        return users.find({ query: { email: email } }).then(function (data) {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            return cb(new errors.BadRequest('Email not found.', { errors: { email: 'Not found.' } }));
          }

          var user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (!user.isVerified) {
            return cb(new errors.BadRequest('Email is not yet verified.', { errors: { email: 'Not verified.' } }));
          }

          return user;
        });
      };

      var promise = Promise.all([findUser(), randomBytes(options.len || 15)]).then(function (_ref3) {
        var _ref4 = _slicedToArray(_ref3, 2),
            user = _ref4[0],
            randomStr = _ref4[1];

        return patchUser(user, {
          resetExpires: Date.now() + resetDelay,
          resetToken: randomStr
        });
      }).then(function (user) {
        return sendEmail('forgot', user);
      }).then(function (user) {
        return sanitizeUserForClient(user);
      });

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function resetPwd(token, password, cb) {
      debug('reset', token, password);

      var findUser = function findUser() {
        return users.find({ query: { resetToken: token } }).then(function (data) {
          if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
            throw new errors.BadRequest('Reset token not found.', { errors: { $className: 'notFound' } });
          }

          var user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

          if (!user.isVerified) {
            throw new errors.BadRequest('Email is not verified.', { errors: { $className: 'notVerified' } });
          }
          if (user.resetExpires < Date.now()) {
            throw new errors.BadRequest('Reset token has expired.', { errors: { $className: 'expired' } });
          }

          return user;
        });
      };

      var promise = Promise.all([findUser(), hashPassword(app, password)]).then(function (_ref5) {
        var _ref6 = _slicedToArray(_ref5, 2),
            user = _ref6[0],
            hashedPassword = _ref6[1];

        return patchUser(user, {
          password: hashedPassword,
          resetToken: null,
          resetExpires: null
        });
      }).then(function (user) {
        return sendEmail('reset', user);
      }).then(function (user) {
        return sanitizeUserForClient(user);
      });

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function passwordChange(user, oldPassword, password, cb) {
      debug('password', oldPassword, password);

      var findUser = function findUser() {
        return users.find({ query: { email: user.email } }).then(function (data) {
          return Array.isArray(data) ? data[0] : data.data[0];
        });
      }; // email is unique

      var promise = findUser().then(function (user1) {
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
        return sendEmail('password', user1);
      }).then(function (user1) {
        return sanitizeUserForClient(user1);
      });

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

    function emailChange(user, password, email, cb) {
      // note this call does not update the authenticated user info in hooks.params.user.
      debug('email', password, email);

      var findUser = function findUser() {
        var idType = user._id ? '_id' : 'id';
        return users.find({ query: _defineProperty({}, idType, user[idType]) }).then(function (data) {
          return Array.isArray(data) ? data[0] : data.data[0];
        }); // id is unique
      };

      var promise = findUser().then(function (user1) {
        return Promise.all([user1, comparePasswords(password, user1.password, function () {
          return new errors.BadRequest('Password is incorrect.', { errors: { password: 'Password is incorrect.' } });
        })]);
      }).then(function (_ref9) {
        var _ref10 = _slicedToArray(_ref9, 1),
            user1 = _ref10[0];

        return sendEmail('email', user1, email);
      }) // value from comparePassword not need
      .then(function (user1) {
        return patchUser(user1, { email: email });
      }).then(function (user1) {
        return sanitizeUserForClient(user1);
      });

      if (cb) {
        promiseToCallback(promise)(cb);
      }

      return promise;
    }

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

    function patchUser(user, patchToUser) {
      return users.patch(user.id || user._id, patchToUser, {}).then(function () {
        return Object.assign(user, patchToUser);
      });
    }

    function sendEmail(emailAction, user, email) {
      var user1 = Object.assign({}, user, email ? { newEmail: email } : {});

      return new Promise(function (resolve, reject) {
        emailer(emailAction, sanitizeUserForEmail(user1), params, function (err2) {
          debug(emailAction + '. Completed.');
          return err2 ? reject(err2) : resolve(user);
        });
      });
    }

    function promiseToCallback(promise) {
      return function (cb) {
        promise.then(function (data) {
          process.nextTick(cb, null, data);
        }, function (err) {
          process.nextTick(cb, err);
        });

        return null;
      };
    }

    function sanitizeUserForClient(user) {
      var user1 = Object.assign({}, user);

      delete user1.password;
      delete user1.verifyExpires;
      delete user1.verifyToken;
      delete user1.resetExpires;
      delete user1.resetToken;

      return user1;
    }

    function sanitizeUserForEmail(user) {
      var user1 = Object.assign({}, user);
      delete user1.password;
      return user1;
    }
  };
};

// Hooks

module.exports.hooks = {};

module.exports.hooks.addVerification = function (options) {
  return function (hook) {
    options = options || {};
    utils.checkContext(hook, 'before', 'create');

    return randomBytes(options.len || 15).then(function (token) {
      hook.data.isVerified = false;
      hook.data.verifyExpires = Date.now() + (options.delay || defaultVerifyDelay);
      hook.data.verifyToken = token;

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
        delete user.resetToken;
      }
    }
  };
};

// Helpers

function randomBytes(len) {
  return new Promise(function (resolve, reject) {
    crypto.randomBytes(len, function (err, buf) {
      return err ? reject(err) : resolve(buf.toString('hex'));
    });
  });
}