
/* global module: 0 */
// Wrapper for client interface to feathers-service-verify-reset

function VerifyReset(app) { // eslint-disable-line no-unused-vars
  if (!(this instanceof VerifyReset)) {
    return new VerifyReset(app);
  }

  const verifyReset = app.service('/verifyReset/:action/:value');

  this.unique = function unique(uniques, ownId, ifErrMsg, cb) {
    verifyReset.create({
      action: 'unique',
      value: uniques,
      ownId,
      meta: { noErrMsg: ifErrMsg },
    }, {})
      .then(() => cb())
      .catch(err => cb(err));
  };

  this.resendVerify = function resendVerify(emailOrToken, cb) {
    verifyReset.create({
      action: 'resend',
      value: emailOrToken,
    }, {}, cb);
  };

  this.verifySignUp = function verifySignUp(slug, cb) {
    verifyReset.create({
      action: 'verify',
      value: slug,
    }, {}, cb);
  };

  this.sendResetPassword = function sendResetPassword(email, cb) {
    verifyReset.create({
      action: 'forgot',
      value: email,
    }, {}, cb);
  };

  this.saveResetPassword = function saveResetPassword(token, password, cb) {
    verifyReset.create({
      action: 'reset',
      value: { token, password },
    }, {}, cb);
  };

  this.changePassword = function changePassword(oldPassword, password, user, cb) {
    verifyReset.create({
      action: 'password',
      value: { oldPassword, password },
    }, { user }, cb);
  };

  this.changeEmail = function changeEmail(password, email, user, cb) {
    verifyReset.create({
      action: 'email',
      value: { password, email },
    }, { user }, cb);
  };

  this.authenticate = function authenticate(email, password, cb) {
    app.authenticate({ type: 'local', email, password })
      .then((result) => {
        const user = result.data;

        if (!user || !user.isVerified) {
          app.logout();
          cb(new Error(user ? 'User\'s email is not verified.' : 'No user returned.'));
          return;
        }

        cb(null, user);
      })
      .catch((err) => {
        cb(err);
      });
  };
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = VerifyReset;
}
