
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

document.getElementById('verify-user-short').addEventListener('click', verifyUserShort);
const verifyShortEl = document.getElementById('verify-short');
const verifyEmailEl = document.getElementById('verify-email');

document.getElementById('signin-user').addEventListener('click', signIn);
const emailSignInEl = document.getElementById('email-signin');
const passwordSignInEl = document.getElementById('password-signin');

document.getElementById('log-out').addEventListener('click', logOut);

document.getElementById('message').addEventListener('click', message);

document.getElementById('reset-pwd').addEventListener('click', sendResetPwd);
const resetEmailEl = document.getElementById('reset-email');

// verified sign up panel
const verifySignupLongEl = document.getElementById('verify-signup');
document.getElementById('sign-in').addEventListener('click', controlPanel);

// reset password panel
const resetPwdLongEl = document.getElementById('reset-password');
const passwordResetEl = document.getElementById('password-reset');
const resetTokenEl = document.getElementById('reset-token');
document.getElementById('do-reset').addEventListener('click', saveResetPwd);

// display utility
function displayActiveDom(ifControlPanel, ifverifySignupLong, ifresetPwdLong) {
  controlPanelEl.style.display = ifControlPanel ? 'block' : 'none';
  verifySignupLongEl.style.display = ifverifySignupLong ? 'block' : 'none';
  resetPwdLongEl.style.display = ifresetPwdLong ? 'block' : 'none';
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
console.log('router', leader, provider, action, slug);

switch (action) {
  case 'verify':
    console.log(`--- feathers provider: ${apiType}, page mode: verify sign up.`);
    verifySignupLong(slug);
    break;
  case 'forgot':
    console.log(`--- feathers provider: ${apiType}, page mode: reset password.`);
    resetPwdLong(slug);
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

  // We are not checking that the email is unique.
  // Could do verifyReset.checkUnique({ email }).then(() => unique).catch(errs => what's not unique)
  users.create(user, (err, user1) => {
    if (err) {
      errorHandler(err);
      return controlPanel();
    }

    console.log('user added', user1);
    verifyEl.href = `http://localhost:3030/${apiType}/verify/${user1.verifyToken}`;
    verifyEl.text = `http://localhost:3030/${apiType}/verify/${user1.verifyToken}`;
    verifyShortEl.value = user1.verifyShortToken;
    verifyEmailEl.value = user1.email;
    resendEmailEl.value = user1.email;
    emailSignInEl.value = user1.email;
    passwordSignInEl.value = passwordEl.value;
    resetEmailEl.value = user1.email;
  });
}

function verifyUserShort() {
  const token = verifyShortEl.value;
  const email = verifyEmailEl.value;
  console.log('--- SMS verify:', token, email);
  if (!token || !email) {
    console.log('ERROR: enter token and email');
    return;
  }
  verifyReset.verifySignupShort(token, { email }, (err, user) => {
    console.log('SMS verify err', err);
    if (err) {
      errorHandler(err);
      return controlPanel();
    }
    console.log('SMS verification', user);
  });
}

function resendVerify() {
  const email = resendEmailEl.value;
  console.log('--- resendVerify:', email);

  if (!email) {
    console.log('ERROR: enter email');
    return;
  }

  verifyReset.resendVerifySignup(email, { transport: 'email', route: apiType }, (err, user) => {
    console.log('client resendVerify err', err);
    if (err) {
      errorHandler(err);
      return controlPanel();
    }

    console.log('user verification changed', user);

    verifyEl.href = '';
    verifyEl.text = '';
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

  verifyReset.sendResetPwd(email, { transport: 'email', route: apiType }, (err, user) => {
    if (err) {
      errorHandler(err);
      return controlPanel();
    }

    console.log('user reset changed', user);
  });
}

/*
 Verify Sign Up
 */

function verifySignupLong(slug1) {
  displayActiveDom(true, false, false);

  verifyReset.verifySignupLong(slug1, (err) => {
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

function resetPwdLong() {
  console.log('--- resetPwdLong');
  displayActiveDom(false, false, true);
  resetTokenEl.value = slug;
}

function saveResetPwd() {
  const password = passwordResetEl.value;
  console.log('--- resetPwdLong', password);

  if (!password) {
    console.log('ERROR: enter password');
    return;
  }

  verifyReset.resetPwdLong(slug, password, (err) => {
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
