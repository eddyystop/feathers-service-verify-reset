'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

/* eslint consistent-return: 0, no-param-reassign: 0, no-var: 0, vars-on-top: 0 */

var crypto = require('crypto');
var errors = require('feathers-errors');
var auth = require('feathers-authentication').hooks;
var utils = require('feathers-hooks-utils');
var debug = require('debug')('verifyReset');

var defaultVerifyDelay = 1000 * 60 * 60 * 24 * 5; // 5 days
var defaultResetDelay = 1000 * 60 * 60 * 2; // 2 hours

/*
 Service
 */

/**
 * Feathers-service-verify-reset service to verify user's email, and to reset forgotten password.
 *
 * @param {Object?} options for service
 *
 * options.emailer - function(action, user, provider, cb) sends an email for 'action'.
 *    action    function performed: resend, verify, forgot, reset.
 *    user      user's information.
 *    provider  transport used: rest (incl raw HTTP), socketio, primus or undefined (internal)
 *
 *    The forgot (reset forgotten password) and resend (resend user email verification)
 *    are needed to provide the user a link. The other emails are optional.
 *
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
    var users;
    var params;

    app.use('/verifyReset/:action/:value', {
      create: function create(data, params1, cb) {
        debug('service called. action=' + data.action + ' value=' + data.value);
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
            throw new errors.BadRequest('Action "' + data.action + '" is invalid.');
        }
      }
    });

    function resendVerifySignUp(email, cb) {
      debug('resend');
      users.find({ query: { email: email } }).then(function (data) {
        if (!Array.isArray(data) && data.total === 0) {
          return cb(new errors.BadRequest('Email "' + email + '" not found.'));
        }

        var user;
        if (Array.isArray(data)) {
          user = data[0];
        } else {
          user = data.data[0];
        }

        if (user.isVerified) {
          return cb(new errors.BadRequest('User is already verified.'));
        }

        addVerifyProps(user, {}, function (err, user1) {
          users.update(user1._id, user1, {}, // eslint-disable-line no-underscore-dangle
          function (err1, user2) {
            if (err1) {
              throw new errors.GeneralError(err1);
            }

            emailer('resend', clone(user2), params, function (err2) {
              debug('resend. Completed.');
              cb(err2, getClientUser(user2));
            });
          });
        });
      }).catch(function (err) {
        throw new errors.GeneralError(err);
      });
    }

    function verifySignUp(token, cb) {
      debug('verify');
      users.find({ query: { verifyToken: token } }).then(function (data) {
        if (data.total === 0) {
          return cb(new errors.BadRequest('Verification token not found.'));
        }

        var user = data.data[0]; // Only 1 entry as token are unique

        if (user.isVerified) {
          return cb(new errors.BadRequest('User is already verified.'));
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
          return cb(new errors.BadRequest('Verification token has expired.'));
        }

        users.update(user._id, user, {}, // eslint-disable-line no-underscore-dangle
        function (err, user1) {
          if (err) {
            throw new errors.GeneralError(err);
          }

          emailer('verify', clone(user1), params, function (err1) {
            debug('verify. Completed.');
            cb(err1, getClientUser(user1));
          });
        });
      }).catch(function (err) {
        throw new errors.GeneralError(err);
      });
    }

    function sendResetPwd(email, cb) {
      debug('forgot');
      users.find({ query: { email: email } }).then(function (data) {
        if (!Array.isArray(data) && data.total === 0) {
          return cb(new errors.BadRequest('Email "' + email + '" not found.'));
        }

        var user;
        if (Array.isArray(data)) {
          user = data[0];
        } else {
          user = data.data[0];
        }

        if (!user.isVerified) {
          return cb(new errors.BadRequest('User\'s email is not yet verified.'));
        }

        crypto.randomBytes(15, function (err, buf) {
          if (err) {
            throw new errors.GeneralError(err);
          }

          user.resetExpires = Date.now() + resetDelay;
          user.resetToken = buf.toString('hex');

          users.update(user._id, user, {}, // eslint-disable-line no-underscore-dangle
          function (err1, user1) {
            if (err1) {
              throw new errors.GeneralError(err1);
            }

            emailer('forgot', clone(user1), params, function (err2) {
              debug('forgot. Completed.');
              cb(err2, getClientUser(user1));
            });
          });
        });
      }).catch(function (err) {
        throw new errors.GeneralError(err);
      });
    }

    function resetPwd(token, json, cb) {
      debug('reset. json=' + JSON.stringify(json));
      users.find({ query: { resetToken: token } }).then(function (data) {
        if (!Array.isArray(data) && data.total === 0) {
          return cb(new errors.BadRequest('Email "' + email + '" not found.'));
        }

        var user;
        if (Array.isArray(data)) {
          user = data[0];
        } else {
          user = data.data[0];
        }

        if (!user.isVerified) {
          return cb(new errors.BadRequest('User\'s email is not verified.'));
        }
        if (user.resetExpires < Date.now()) {
          return cb(new errors.BadRequest('Reset token has expired.'));
        }

        // hash the password just like create: [ auth.hashPassword() ]

        var hook = {
          type: 'before',
          data: { password: json.password },
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

          users.update(user._id, user, {}, // eslint-disable-line no-underscore-dangle
          function (err, user1) {
            if (err) {
              throw new errors.GeneralError(err);
            }

            emailer('reset', clone(user1), params, function (err1) {
              debug('reset. Completed.');
              cb(err1, getClientUser(user1));
            });
          });
        }).catch(function (err) {
          throw new errors.GeneralError(err);
        });
      }).catch(function (err) {
        throw new errors.GeneralError(err);
      });
    }

    function getClientUser(user) {
      var client = clone(user);
      delete client.password;
      return client;
    }
  };
};

/*
 Hooks
 */

module.exports.hooks = {};

module.exports.hooks.addVerification = function (options) {
  return function (hook, next) {
    utils.checkContext(hook, 'before', 'create');

    addVerifyProps(hook.data, options, function (err, data) {
      hook.data = data;
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

    if (user) {
      delete user.verifyExpires;
      delete user.resetExpires;
      if (!ifReturnTokens) {
        delete user.verifyToken;
        delete user.resetToken;
      }
    }
  };
};

/*
 Helpers
 */

var addVerifyProps = function addVerifyProps(data, options, cb) {
  options = options || {};

  crypto.randomBytes(options.len || 15, function (err, buf) {
    if (err) {
      throw new errors.GeneralError(err);
    }

    data.isVerified = false;
    data.verifyExpires = Date.now() + (options.delay || defaultVerifyDelay);
    data.verifyToken = buf.toString('hex');

    cb(null, data);
  });
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}