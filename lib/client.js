'use strict';

/* global module: 0 */
// Wrapper for client interface to feathers-service-verify-reset

function VerifyReset(app) {
  // eslint-disable-line no-unused-vars
  if (!(this instanceof VerifyReset)) {
    return new VerifyReset(app);
  }

  var verifyReset = app.service('/verifyReset/:action/:value');

  this.unique = function unique(uniques, ownId, ifErrMsg, cb) {
    verifyReset.create({
      action: 'unique',
      value: uniques,
      ownId: ownId,
      meta: { noErrMsg: ifErrMsg }
    }, {}, cb);
  };

  this.resendVerify = function resendVerify(emailOrToken, cb) {
    verifyReset.create({
      action: 'resend',
      value: emailOrToken
    }, {}, cb);
  };

  this.verifySignUp = function verifySignUp(slug, cb) {
    verifyReset.create({
      action: 'verify',
      value: slug
    }, {}, cb);
  };

  this.sendResetPassword = function sendResetPassword(email, cb) {
    verifyReset.create({
      action: 'forgot',
      value: email
    }, {}, cb);
  };

  this.saveResetPassword = function saveResetPassword(token, password, cb) {
    verifyReset.create({
      action: 'reset',
      value: { token: token, password: password }
    }, {}, cb);
  };

  this.changePassword = function changePassword(oldPassword, password, user, cb) {
    verifyReset.create({
      action: 'password',
      value: { oldPassword: oldPassword, password: password }
    }, { user: user }, cb);
  };

  this.changeEmail = function changeEmail(password, email, user, cb) {
    verifyReset.create({
      action: 'email',
      value: { password: password, email: email }
    }, { user: user }, cb);
  };

  this.authenticate = function authenticate(email, password, cb) {
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
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = VerifyReset;
}