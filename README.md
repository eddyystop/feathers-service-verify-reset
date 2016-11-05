## feathers-service-verify-reset
Adds user email verification, forgotten password reset, and other capabilities to local
[`feathers-authentication`](http://docs.feathersjs.com/authentication/local.html).

[![Build Status](https://travis-ci.org/eddyystop/feathers-service-verify-reset.svg?branch=master)](https://travis-ci.org/eddyystop/feathers-service-verify-reset)
[![Coverage Status](https://coveralls.io/repos/github/eddyystop/feathers-service-verify-reset/badge.svg?branch=master)](https://coveralls.io/github/eddyystop/feathers-service-verify-reset?branch=master)

- Checking that values for fields like email and username are unique within `users` items.
- Hooks for adding a new user.
- Send another email address verification, routing through your email or SMS transports.
- Process an email address verification from a URL response.
- Process an email address verification from an SMS notification.
- Send a forgotten password reset, routing through your email or SMS transports.
- Process a forgotten password reset from a URL response.
- Process a forgotten password reset from an SMS notification.
- Process password change.
- Process email address change.

User notifications may be sent for:

- Email addr verification request when a new user is created.
- Resending a new email addr verification, e.g. previous verification email was lost or is expired.
- Successful user verification.
- Sending an email to reset the password when the password is forgotten.
- Successful password reset for a forgotten password.
- Manual change of a password.
- The previous email address is notified of a change of email address.

A 30-char slug is generated suitable for URL responses embedded in email,
SMS or social media notifications.
(Configurable length.)
This may be embedded in URL links sent by email or SMS
so that clicking the link starts the email address verification or the password reset.

A 6-digit slug is also generated suitable for notification by SMS or social media.
(Configurable length, may be alphanumeric instead.)
This slug may be manually entered in a UI to start the email address verification or the password reset.

The email verification slug has a 5-day expiry (configurable),
while the password reset has a 2 hour expiry (configurable).

Typically your user notifier refers to a property like `user.preferredCommunication: 'email'`
to determine which transport to use for user notification.
However the API allows the UI to be set up to ask the user which transport they prefer this time,
when resending a email address verification and sending a forgotten password reset.

The server does not handle any interactions with the user.
Leaving it a pure API server, lets it be used with both native and browser clients.

## Code Example

The folder `example` presents a full featured server/browser implementation
whose UI lets you try the API.
*todo: update example/ to latest features*

### Server

Configure package in Feathersjs.

```javascript
const verifyReset = require('feathers-service-verify-reset').service;

module.exports = function () { // 'function' needed as we use 'this'
  const app = this;
  app.configure(authentication);
  app.configure(verifyReset({ userNotifier })); // line added
  app.configure(user);
  app.configure(message);
};

function userNotifier(action, user, notifierOptions, newEmail, cb) {
  switch (action) {
    // resend (send another verification email), verify (email addr has been verified)
    // forgot (send forgot password email), reset (password has been reset)
  }
  cb(null);
}
```

The `users` service is expected to be already configured.
Its `patch` method is used to update the password when needed
and therefore `path` may *not* have a `auth.hashPassword()` hook.

An email to verify the user's email addr can be sent when user if created on the server,
e.g. `/src/services/user/hooks/index`:

```javascript
const verifyHooks = require('feathers-service-verify-reset').hooks;

exports.before = {
  // ...
  create: [
    auth.hashPassword(),
    verifyHooks.addVerification(), // set email addr verification info
  ],

exports.after = {
  // ...
  create: [
    hooks.remove('password'), // hook is ignored if server initiated operation
    emailVerification, // send email to verify the email addr
    verifyHooks.removeVerification(), // hook is ignored if server initiated operation
  ],
};

function emailVerification(hook, next) {
  // ...
  next(null, hook);
}
```

#### <a name="database"> Database

The service adds the following optional properties to the user item.
You should add them to your user model if your database uses models.

```javascript
{
  isVerified: { type: Boolean },
  verifyToken: { type: String },
  verifyExpires: { type: Date }, // or a long integer
  resetToken: { type: String },
  resetExpires: { type: Date }, // or a long integer
}
```


### Client

Client loads a wrapper for the package

```html
<script src=".../feathers-service-verify-reset/lib/client.js"></script>
```

or
```javascript
import VerifyRest from 'feathers-service-verify-reset/lib/client'; 
```

and then uses convenient APIs.

```javascript
const app = feathers() ...
const verifyReset = new VerifyReset(app);

// Verify the username and email are unique.
verifyReset.unique({ username, email }, null, false, (err) => { // not unique if err ... });

// Add a new user, using standard feathers users service.
// Then send a verification email with a link containing a slug.
users.create(user, (err, user) => { ... });

// Resend another email address verification email. New link, new slug.
verifyReset.resendVerify(email, (err, user) => { ... });
verifyReset.resendVerify({ verifyToken }, (err, user) => { ... })

// Verify email address once user clicks link in the verification email.
// Then send a confirmation email.
verifyReset.verifySignUp(slug, (err, user) => { ... });

// Authenticate (sign in) user, requiring user to be verified.
verifyReset.authenticate(email, password, (err, user) => { ... });

// Send email for a forgotten password with a link containing a slug.
verifyReset.sendResetPassword(email, (err, user) => { ... });

// Reset the new password once the user follows the link in the reset email 
// and enters a new password. Then send a confirmation email.
verifyReset.saveResetPassword(slug, password, (err, user) => { ... });

// Change the password and send a confirmation email.
verifyReset.changePassword(oldPassword, newPassword, currentUser, (err, user) => { ... });

// Change the email and send a confirmation email to the old email address..
verifyReset.changeEmail(password, newEmail, currentUser, (err, user) => { ... });
```

A promise is always returned by each API.
The callback, if provided, is invoked in a scope outside the Promise chain
so any error in the callback will not cause a `.catch` to fire.

### Routing

The client handles all interactions with the user.
Therefore the server must serve the client app when an email link is followed,
and the client must do some routing based on the path in the link.

Assume you have sent the email link:
`http://localhost:3030/socket/verify/12b827994bb59cacce47978567989e`

The server serves the client app on `/socket`:

```javascript
// Express-like middleware provided by Feathersjs.
app.use('/', serveStatic(app.get('public')))
   .use('/socket', (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', 'public', 'socket.html')); // serve the client
  })
```

The client then routes itself based on the URL.
You will likely use you favorite client-side router,
but a way primitive routing would be:

```javascript
const [leader, provider, action, slug] = window.location.pathname.split('/');

switch (action) {
  case 'verify':
    verifySignUp(slug);
    break;
  case 'reset':
    resetPassword(slug);
    break;
  default:
    // normal app startup
}
```

## Motivation

Email addr verification and handling forgotten passwords are common features
these days. This package adds that functionality to Feathersjs.

## Install package

Install [Nodejs](https://nodejs.org/en/).

Run `npm install feathers-service-verify-reset --save` in your project folder.

You can then require the utilities.

`/src` on GitHub contains the ES6 source.
It will run on Node 6+ without transpiling.


## Install and run example

`cd example`

`npm install`

`npm start`

Point browser to `localhost:3030/socket` for the socketio client,
to `localhost:3030/rest` for the rest client.

The two clients differ only in their how they configure `feathers-client`.

[feathers-starter-react-redux-login-roles](https://github.com/eddyystop/feathers-starter-react-redux-login-roles)
is a full-featured example of using this repo with React and Redux.

## API Reference

The following properties are added to `user` data:

- `isVerified` {Boolean} if user's email addr has been verified.
- `verifyToken` {String|null} token (slug) emailed for email addr verification.
- `verifyExpires` {Number|null} date-time when token expires.
- `resetToken` {String|null?} optional token (slug) emailed for password reset.
- `resetExpires` {Number|null?} date-time when token expires.

See Code Example section above.

See `example` folder for a fully functioning example.

This repo does some of the heavy lifting for
[feathers-starter-react-redux-login-roles](https://github.com/eddyystop/feathers-starter-react-redux-login-roles)
where all of its features are used.

## Tests

`npm run test:only` to run tests with the existing ES5 transpiled code.

`npm test` to transpile to ES5 code, eslint and then run tests on Nodejs 6+.

`npm run cover` to run tests plus coverage.

## <a name="changeLog"></a> Change Log

[List of notable changes.](./CHANGELOG.md)

## Contributors

- [eddyystop](https://github.com/eddyystop)

## License

MIT. See LICENSE.