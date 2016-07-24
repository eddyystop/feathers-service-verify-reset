'use strict';

// Wrapper for client interface to feathers-service-verify-reset

function VerifyReset(app) {
  // eslint-disable-line no-unused-vars
  if (!(this instanceof VerifyReset)) {
    return new VerifyReset(app);
  }
  var verifyReset = app.service('/verifyReset/:action/:value');

  this.resendVerify = function resendVerify(email, cb) {
    verifyReset.create({ action: 'resend', value: email }, cb);
  };
  this.verifySignUp = function verifySignUp(slug, cb) {
    verifyReset.create({ action: 'verify', value: slug }, cb);
  };
  this.sendResetPassword = function sendResetPassword(email, cb) {
    verifyReset.create({ action: 'forgot', value: email }, cb);
  };
  this.saveResetPassword = function saveResetPassword(slug, password, cb) {
    verifyReset.create({ action: 'reset', value: slug, data: { password: password } }, cb);
  };

  this.authenticate = function authenticate(email, password, cb) {
    app.authenticate({ type: 'local', email: email, password: password }).then(function (result) {
      var user = result.data;

      if (!user || !user.isVerified) {
        app.logout();
        cb(new Error(user ? 'User\'s email is not verified.' : 'No user returned.'));
        return;
      }

      cb(null, user);
    }).catch(function (err) {
      cb(err);
    });
  };
}