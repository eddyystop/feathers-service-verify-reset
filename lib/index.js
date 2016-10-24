'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

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

    app.use(path, {
      create: function create(data, params1, cb) {
        debug('service called. action=' + data.action + ' value=' + JSON.stringify(data.value));
        users = app.service('/users'); // here in case users service is configured after verifyReset
        params = params1;

        switch (data.action) {
          case 'unique':
            // the 'return' is needed!
            return checkUniqueness(data.value, data.ownId || null, data.meta || {});
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
            resetPwd(data.value.token, data.value.password, cb);
            break;
          case 'password':
            passwordChange(params.user, data.value.oldPassword, data.value.password, cb);
            break;
          case 'email':
            emailChange(params.user, data.value.password, data.value.email, cb);
            break;
          default:
            throw new errors.BadRequest('Action "' + data.action + '" is invalid.');
        }
      }
    });

    var isAction = function isAction() {
      for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      return function (hook) {
        return args.indexOf(hook.data.action) !== -1;
      };
    };

    app.service(path).before({
      create: [hooks.iff(isAction('password', 'email'), auth.verifyToken()), hooks.iff(isAction('password', 'email'), auth.populateUser())]
    });

    function checkUniqueness(uniques, ownId, meta) {
      var errs = {};
      var keys = Object.keys(uniques).filter(function (key) {
        return uniques[key] !== undefined && uniques[key] !== null;
      });
      var keysLeft = keys.length;

      return new Promise(function (resolve, reject) {
        if (!keysLeft) {
          return resolve();
        }

        keys.forEach(function (prop) {
          debug('query ' + prop + ':' + uniques[prop].trim());
          users.find({ query: _defineProperty({}, prop, uniques[prop].trim()) }) // 1 as unique
          .then(function (data) {
            var items = Array.isArray(data) ? data : data.data;
            if (items.length > 1 || items.length === 1 && (items[0].id || items[0]._id) !== ownId) {
              errs[prop] = 'Already taken.';
            }

            // Check results on last async operation
            if (--keysLeft <= 0) {
              if (!Object.keys(errs).length) {
                resolve();
              }

              reject(new errors.BadRequest(meta.noErrMsg ? null : 'Values already taken.', { errors: errs }));
            }
          }).catch(function (err) {
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

      users.find({ query: query }).then(function (data) {
        if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
          return cb(new errors.BadRequest('Email or verify token not found.', { errors: { email: 'Not found.', token: 'Not found.' } }));
        }

        var user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

        if (user.isVerified) {
          return cb(new errors.BadRequest('User is already verified.', { errors: { email: 'User is already verified.', token: 'User is already verified.' } }));
        }

        crypto.randomBytes(options.len || 15, function (err, buf) {
          if (err) {
            throw new errors.GeneralError(err);
          }

          var patchToUser = {
            isVerified: false,
            verifyExpires: Date.now() + defaultVerifyDelay,
            verifyToken: buf.toString('hex')
          };
          Object.assign(user, patchToUser);

          users.patch(user.id || user._id, patchToUser, {}, function (err1) {
            if (err1) {
              throw new errors.GeneralError(err1);
            }

            emailer('resend', sanitizeUserForEmail(user), params, function (err2) {
              debug('resend. Completed.');
              return cb(err2, sanitizeUserForClient(user));
            });
          });
        });
      }).catch(function (err) {
        throw new errors.GeneralError(err);
      });
    }

    function verifySignUp(token, cb) {
      debug('verify ' + token);

      users.find({ query: { verifyToken: token } }).then(function (data) {
        if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
          return cb(new errors.BadRequest('Verification token was not issued.', { errors: { $className: 'notIssued' } }));
        }

        var user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

        if (user.isVerified) {
          return cb(new errors.BadRequest('User is already verified.', { errors: { $className: 'alreadyVerified' } }));
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
          return cb(new errors.BadRequest('Verification token has expired.', { errors: { $className: 'expired' } }));
        }

        var patchToUser = {
          isVerified: user.isVerified,
          verifyExpires: user.verifyExpires,
          verifyToken: user.verifyToken,
          resetToken: user.resetToken,
          resetExpires: user.resetExpires
        };
        Object.assign(user, patchToUser);

        users.patch(user.id || user._id, patchToUser, {}, function (err) {
          if (err) {
            throw new errors.GeneralError(err);
          }
          emailer('verify', sanitizeUserForEmail(user), params, function (err1) {
            debug('verify. Completed.');
            cb(err1, sanitizeUserForClient(user));
          });
        });
      }).catch(function (err) {
        throw new errors.GeneralError(err);
      });
    }

    function sendResetPwd(email, cb) {
      debug('forgot');
      users.find({ query: { email: email } }).then(function (data) {
        if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
          return cb(new errors.BadRequest('Email not found.', { errors: { email: 'Not found.' } }));
        }

        var user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique
        if (!user.isVerified) {
          return cb(new errors.BadRequest('Email is not yet verified.', { errors: { email: 'Not verified.' } }));
        }
        crypto.randomBytes(15, function (err, buf) {
          if (err) {
            throw new errors.GeneralError(err);
          }

          var patchToUser = {
            resetExpires: Date.now() + resetDelay,
            resetToken: buf.toString('hex')
          };
          Object.assign(user, patchToUser);

          users.patch(user.id || user._id, patchToUser, {}, function (err1) {
            if (err1) {
              throw new errors.GeneralError(err1);
            }

            emailer('forgot', sanitizeUserForEmail(user), params, function (err2) {
              debug('forgot. Completed.');
              cb(err2, sanitizeUserForClient(user));
            });
          });
        });
      }).catch(function (err) {
        throw new errors.GeneralError(err);
      });
    }

    function resetPwd(token, password, cb) {
      debug('reset', token, password);
      users.find({ query: { resetToken: token } }).then(function (data) {
        if (Array.isArray(data) ? data.length === 0 : data.total === 0) {
          return cb(new errors.BadRequest('Reset token not found.', { errors: { $className: 'notFound' } }));
        }

        var user = Array.isArray(data) ? data[0] : data.data[0]; // 1 entry as emails are unique

        if (!user.isVerified) {
          return cb(new errors.BadRequest('Email is not verified.', { errors: { $className: 'notVerified' } }));
        }
        if (user.resetExpires < Date.now()) {
          return cb(new errors.BadRequest('Reset token has expired.', { errors: { $className: 'expired' } }));
        }

        // hash the password just like create: [ auth.hashPassword() ]

        var hook = {
          type: 'before',
          data: { password: password },
          params: { provider: null },
          app: {
            get: function get(str) {
              return app.get(str);
            }
          }
        };

        debug('reset. hashing password.');
        auth.hashPassword()(hook).then(function (hook1) {
          user.password = hook1.data.password;
          user.resetExpires = null;
          user.resetToken = null;

          var patchToUser = {
            password: user.password,
            resetToken: user.resetToken,
            resetExpires: user.resetExpires
          };
          Object.assign(user, patchToUser);

          users.patch(user.id || user._id, patchToUser, {}, function (err) {
            if (err) {
              throw new errors.GeneralError(err);
            }

            emailer('reset', sanitizeUserForEmail(user), params, function (err1) {
              debug('reset. Completed.');
              return cb(err1, sanitizeUserForClient(user));
            });
          });
        }).catch(function (err) {
          throw new errors.GeneralError(err);
        });
      }).catch(function (err) {
        throw new errors.GeneralError(err);
      });
    }

    function passwordChange(user, oldPassword, password, cb) {
      // get user to obtain current password
      users.find({ query: { email: user.email } }).then(function (data) {
        var user1 = Array.isArray(data) ? data[0] : data.data[0]; // email is unique

        // compare old password to encrypted current password
        bcrypt.compare(oldPassword, user1.password, function (err, data1) {
          if (err || !data1) {
            return cb(new errors.BadRequest('Current password is incorrect.', { errors: { oldPassword: 'Current password is incorrect.' } }));
          }

          // encrypt the new password
          var hook = {
            type: 'before',
            data: { password: password },
            params: { provider: null },
            app: {
              get: function get(str) {
                return app.get(str);
              }
            }
          };
          auth.hashPassword()(hook).then(function (hook1) {
            var patchToUser = {
              password: hook1.data.password
            };
            Object.assign(user, patchToUser);

            users.patch(user1.id || user1._id, patchToUser, {}, function (err1) {
              if (err1) {
                throw new errors.GeneralError(err1);
              }

              // send email
              emailer('password', sanitizeUserForEmail(user), params, function (err2) {
                debug('password. Completed.');
                cb(err2, sanitizeUserForClient(user));
              });
            });
          });
        });
      }).catch(function (err) {
        cb(new errors.GeneralError(err));
      });
    }

    // note this call does not update the authenticated user info in hooks.params.user.
    function emailChange(user, password, email, cb) {
      // get user to obtain current password
      var idType = user._id ? '_id' : 'id';
      users.find({ query: _defineProperty({}, idType, user[idType]) }).then(function (data) {
        var user1 = Array.isArray(data) ? data[0] : data.data[0]; // email is unique

        // compare old password to encrypted current password
        bcrypt.compare(password, user1.password, function (err, data1) {
          if (err || !data1) {
            return cb(new errors.BadRequest('Password is incorrect.', { errors: { password: 'Password is incorrect.' } }));
          }

          // send email
          var user3 = sanitizeUserForEmail(user1);
          user3.newEmail = email;
          emailer('email', sanitizeUserForEmail(user3), params, function () {});

          var patchToUser = { email: email };
          Object.assign(user1, patchToUser);

          users.patch(user1.id || user1._id, patchToUser, {}, function (err1) {
            if (err1) {
              throw new errors.GeneralError(err1);
            }

            debug('email. Completed.');
            cb(err1, sanitizeUserForClient(user1));
          });
        });
      }).catch(function (err) {
        cb(new errors.GeneralError(err));
      });
    }

    function sanitizeUserForClient(user) {
      var user1 = clone(user);

      delete user1.password;
      delete user1.verifyExpires;
      delete user1.verifyToken;
      delete user1.resetExpires;
      delete user1.resetToken;

      return user1;
    }

    function sanitizeUserForEmail(user) {
      var user1 = clone(user);

      delete user1.password;

      return user1;
    }
  };
};

// Hooks

module.exports.hooks = {};

module.exports.hooks.addVerification = function (options) {
  return function (hook, next) {
    options = options || {};
    utils.checkContext(hook, 'before', 'create');

    crypto.randomBytes(options.len || 15, function (err, buf) {
      if (err) {
        throw new errors.GeneralError(err);
      }

      hook.data.isVerified = false;
      hook.data.verifyExpires = Date.now() + (options.delay || defaultVerifyDelay);
      hook.data.verifyToken = buf.toString('hex');

      next(null, hook);
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

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}