'use strict';

/* global module: 0 */
// Wrapper for client interface to feathers-service-verify-reset

function VerifyReset(app) {
  // eslint-disable-line no-unused-vars
  if (!(this instanceof VerifyReset)) {
    return new VerifyReset(app);
  }

  var verifyReset = app.service('/verifyReset/:action/:value');

  this.checkUnique = function (uniques, ownId, ifErrMsg, cb) {
    verifyReset.create({
      action: 'checkUnique',
      value: uniques,
      ownId: ownId,
      meta: { noErrMsg: ifErrMsg }
    }, {}, cb);
  };

  this.resendVerify = function (emailOrToken, cb) {
    verifyReset.create({
      action: 'resendVerify',
      value: emailOrToken
    }, {}, cb);
  };

  this.verifySignupLong = function (token, cb) {
    verifyReset.create({
      action: 'verifySignupLong',
      value: token
    }, {}, cb);
  };

  this.verifySignupShort = function (token, userFind, cb) {
    verifyReset.create({
      action: 'verifySignupLong',
      value: { token: token, user: userFind }
    }, {}, cb);
  };

  this.sendResetPwd = function (email, cb) {
    verifyReset.create({
      action: 'sendResetPwd',
      value: email
    }, {}, cb);
  };

  this.resetPwdLong = function (token, password, cb) {
    verifyReset.create({
      action: 'resetPwdLong',
      value: { token: token, password: password }
    }, {}, cb);
  };

  this.resetPwdShort = function (token, userFind, password, cb) {
    verifyReset.create({
      action: 'resetPwdLong',
      value: { token: token, password: password, user: userFind }
    }, {}, cb);
  };

  this.passwordChange = function (oldPassword, password, user, cb) {
    verifyReset.create({
      action: 'passwordChange',
      value: { oldPassword: oldPassword, password: password }
    }, { user: user }, cb);
  };

  this.emailChange = function (password, email, user, cb) {
    verifyReset.create({
      action: 'emailChange',
      value: { password: password, email: email }
    }, { user: user }, cb);
  };

  this.authenticate = function (email, password, cb) {
    var cbCalled = false;

    app.authenticate({ type: 'local', email: email, password: password }).then(function (result) {
      var user = result.data;

      if (!user || !user.isVerified) {
        app.logout();
        cb(new Error(user ? 'User\'s email is not verified.' : 'No user returned.'));
        return;
      }

      cbCalled = true;
      cb(null, user);
    }).catch(function (err) {
      if (!cbCalled) {
        cb(err);
      }
    });
  };

  // backwards compatability
  this.unique = this.checkUnique;
  this.verifySignUp = this.verifySignupLong;
  this.sendResetPassword = this.sendResetPwd;
  this.saveResetPassword = this.resetPwdLong;
  this.changePassword = this.passwordChange;
  this.changeEmail = this.emailChange;
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = VerifyReset;
}