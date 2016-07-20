
/* global apiType, app, VerifyReset */
/* eslint consistent-return: 0, no-console: 0 */

/*
 DOM
 */

// control panel
const controlPanelEl = document.getElementById('control-panel');

document.getElementById('add-user').addEventListener('click', addUser);
const nameEl = document.getElementById('name');
const emailEl = document.getElementById('email');
const passwordEl = document.getElementById('password');

document.getElementById('resend-verify').addEventListener('click', resendVerify);
const resendEmailEl = document.getElementById('resend-email');

const verifyEl = document.getElementById('verify');

document.getElementById('signin-user').addEventListener('click', signIn);
const emailSignInEl = document.getElementById('email-signin');
const passwordSignInEl = document.getElementById('password-signin');

document.getElementById('log-out').addEventListener('click', logOut);

document.getElementById('message').addEventListener('click', message);

document.getElementById('reset-pwd').addEventListener('click', sendResetPwd);
const resetEmailEl = document.getElementById('reset-email');

const resetEl = document.getElementById('reset');

// verified sign up panel
const verifySignupEl = document.getElementById('verify-signup');
document.getElementById('sign-in').addEventListener('click', controlPanel);

// reset password panel
const resetPasswordEl = document.getElementById('reset-password');
const passwordResetEl = document.getElementById('password-reset');
document.getElementById('do-reset').addEventListener('click', saveResetPwd);
const resetTokenEl = document.getElementById('reset-token');

// display utility
function displayActiveDom(ifControlPanel, ifVerifySignup, ifResetPassword) {
  controlPanelEl.style.display = ifControlPanel ? 'block' : 'none';
  verifySignupEl.style.display = ifVerifySignup ? 'block' : 'none';
  resetPasswordEl.style.display = ifResetPassword ? 'block' : 'none';
}

/*
 feathers services
 */

const users = app.service('/users');
const messages = app.service('/messages');

const verifyReset = new VerifyReset(app);

/*
 Routing
 */

const [leader, provider, action, slug] = // eslint-disable-line no-unused-vars
  window.location.pathname.split('/');

switch (action) {
  case 'verify':
    console.log(`--- feathers provider: ${apiType}, page mode: verify sign up.`);
    verifySignUp(slug);
    break;
  case 'reset':
    console.log(`--- feathers provider: ${apiType}, page mode: reset password.`);
    resetPassword(slug);
    break;
  default:
    console.log(`--- feathers provider: ${apiType}, page mode: control panel.`);
    controlPanel();
}

/*
 Control panel
 */

function controlPanel() {
  displayActiveDom(true, false, false);
}

function addUser() {
  console.log('--- addUser');

  const user = {
    username: nameEl.value,
    email: emailEl.value,
    password: passwordEl.value,
  };

  if (!user.username || !user.email || !user.password) {
    console.log('ERROR: enter name, email and password');
    return;
  }

  users.create(user, (err, user1) => {
    if (err) {
      errorHandler(err);
      return controlPanel();
    }

    console.log('user added', user1);

    verifyEl.href = `http://localhost:3030/${apiType}/verify/${user1.verifyToken}`;
    verifyEl.text = `http://localhost:3030/${apiType}/verify/${user1.verifyToken}`;
    resendEmailEl.value = user1.email;
    emailSignInEl.value = user1.email;
    passwordSignInEl.value = passwordEl.value;
    resetEmailEl.value = user1.email;
  });
}

function resendVerify() {
  const email = resendEmailEl.value;
  console.log('--- resendVerify:', email);

  if (!email) {
    console.log('ERROR: enter email');
    return;
  }

  verifyReset.resendVerify(email, (err, user) => {
    if (err) {
      errorHandler(err);
      return controlPanel();
    }

    console.log('user verification changed', user);

    verifyEl.href = `http://localhost:3030/${apiType}/verify/${user.verifyToken}`;
    verifyEl.text = `http://localhost:3030/${apiType}/verify/${user.verifyToken}`;
  });
}

function signIn() {
  console.log('--- signIn');
  const email = emailSignInEl.value;
  const password = passwordSignInEl.value;

  if (!email || !password) {
    console.log('ERROR: enter email and password');
    return;
  }

  verifyReset.authenticate(email, password, (err, user) => {
    if (err) {
      errorHandler(err);
      return;
    }

    console.log('signed in user', user);
  });
}

function logOut() {
  console.log('--- logOut');

  app.logout()
    .then(() => {
      console.log('logged out');
    })
    .catch(err => {
      errorHandler(err);
    });
}

function message() {
  console.log('--- create a message');
  messages.create({ text: 'hello' }, (err) => {
    if (err) { return errorHandler(err); }

    console.log('user is verified. message created.');
  });
}

function sendResetPwd() {
  const email = resetEmailEl.value;
  console.log('--- sendResetPwd:', email);

  if (!email) {
    console.log('ERROR: enter email');
    return;
  }

  verifyReset.sendResetPassword(email, (err, user) => {
    if (err) {
      errorHandler(err);
      return controlPanel();
    }

    console.log('user reset changed', user);

    resetEl.href = `http://localhost:3030/${apiType}/reset/${user.resetToken}`;
    resetEl.text = `http://localhost:3030/${apiType}/reset/${user.resetToken}`;
  });
}

/*
 Verify Sign Up
 */

function verifySignUp(slug1) {
  displayActiveDom(true, false, false);

  verifyReset.verifySignUp(slug1, (err) => {
    if (err) {
      errorHandler(err);
      return controlPanel();
    }

    displayActiveDom(false, true, false);
  });
}

/*
 Reset Password
 */

function resetPassword(slug1) {
  displayActiveDom(false, false, true);
  resetTokenEl.value = slug1;
}

function saveResetPwd() {
  const password = passwordResetEl.value;
  console.log('--- saveResetPassword', password);

  if (!password) {
    console.log('ERROR: enter password');
    return;
  }

  verifyReset.saveResetPassword(slug, password, (err) => {
    if (err) {
      errorHandler(err);
      return controlPanel();
    }

    displayActiveDom(true, false, false);
  });
}

/*
 Utilities
 */

function errorHandler(err) {
  console.log(`**** ERROR\nmessage: ${err.message}`);
  console.log(`name: ${err.name}, status code: ${err.code}, class: ${err.className}`);
  console.log('errors:', JSON.stringify(err.errors));
  console.log('stack:', err);
}
