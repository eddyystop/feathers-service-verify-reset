# Notable changes to feathers-service-verify-reset

## 1.0.1
### Fixes
- The client wrappers now return Promises, as documented, when a callback is not used.
https://github.com/eddyystop/feathers-service-verify-reset/issues/20

## 0.8.0
### Enhancements
- The repo has been rewritten to use Promises throughout.
- A promise is returned when an API call does not include a callback function.
- `hooks.removeVerification` warns on `users::create` if the `isVerified` property is not found.
This could occur when using a model driven DB where the
[5 fields](./README.md#-database)
required by this repo have not been added to the model.
It may also occur if `hooks.addVerification` was not added as a `before` hook.
- Example UI no longer shows a wrong URL for verification resend.
That was a result of closing a security loophole.
The resend URL is logged to the console.
- Dependencies updated.

### Docs
- README updated for APIs returning Promises.
- README updated for required database fields.git status


### Thanks
- [beeplin](https://github.com/beeplin)
for [getting us to convert to Promises](https://github.com/eddyystop/feathers-service-verify-reset/issues/12).

## 0.7.0
### Enhancements
- Feathers promises are used internally rather than callbacks.
The Promises are converted to callbacks by the repo.
There was a report that feathers-mongo had swallowed a duplicate key error on the server.
Hopefully this will prevent that if it does happen.

## 0.6.1
### Fixes
- Changes to `users` done using `.patch`. Patch hooks may not change `password`.
### Internal changes
- Node 6.9.1 identified some issues where the cb was called again if prev cb threw.

## 0.5.5
### Fixes
- The password was not updating properly on `verify` and `rest`. Thanks @beeplin.

## 0.5.4
### Fixes
- Fixed example bringing it up to date with repo.

## 0.5.2
### Internal changes
- User item returned on callback is now better sanitized.

## 0.5.0
### Internal changes
- Supports DBs that use _id_ for their key instead of __id_ e.g. Postgress.
Only the 'query' option is tested for this until I figure out how to test the others.

## 0.4.0

(1) The `/lib/client` wrapper may now be used with `require` or `import`,
as well as the original `script`.
The wrapper had a **bug** in each method. These are now fixed and have unit tests.

(2) User records may require unique field values, e.g. email address and username.
You can now check given values are unique among all user records with

```javascript
const uniques = { username, email }; // 0, 1 or more fields that must be unique
const ownId = user._id; // Ignore current user. Needed if you're changing current user's record.
const ifErrMsg = false; // No err.message but err.errors[...] would always have messages.

// client wrapper style
verifyReset.unique(uniques, ownId, ifErrMsg, cb);
// feathers service style
app.verifyReset.create({ action: 'unique', value: uniques, ownId, meta: { noErrMsg: ifErrMsg } })
  .then(() => /* are unique */)
  .catch(err => /* err.message plus err.errors.username & err.errors.email */
```

(3) You can now change the current user's password.
The email handler is called with `action = 'password'`.

```javascript
// client wrapper style
verifyReset.changePassword(oldPassword, password, user, cb); // pass curr user from authentication
// feathers service style
app.verifyReset.create({ action: 'password', value: { oldPassword, password } }, { user }, cb);
  .then(user => /* changed */)
```

(4) You can now change the current user's email address.
The email handler is called with `action = 'email'` and `user.newEmail`.

```javascript
// client wrapper style
verifyReset.changeEmail(password, email, user, cb); // pass current user from authentication
// feathers service style
app.verifyReset.create({ action: 'email', value: { password, email } }, { user }, cb);
  .then(user => /* changed */)
```

### Other changes
- **Save password reset.** The client wrapper style remains unchanged,
however there is a **_breaking change_** in the feathers service style.

```javascript
// was
app.verifyReset.create({ action: 'reset', value: token, data: { password } }, cb);
// is now
app.verifyReset.create({ action: 'reset', value: { token, password } }, cb);
```
- **Resend verify sign up.** Both the client wrapper and feathers service style
remain backward compatible, with their string param being the email address.
However `{ verifyToken }` now allows the users to be searched by their current
verify token instead of their email address.

```javascript
verifyReset.resendVerify('feathers@feathers.com', cb); // or { email: 'feathers@feathers.com' } 
verifyReset.resendVerify({ verifyToken: '...' }, cb);
````
- Non-paginated `users` files are now handled properly. **Bug.**
All tests include tests for non-paginated `users`.
- `err.errors[fieldName]` or `err.errors.$className` have been added to BadRequest responses
to facilitate form handling, logic or internationalization,
- **Example.** Email handler expanded to show new email options.
- The new `options.delay` props for `app.configure(verifyReset(options))`
controls how long the sign up verification email is valid for (ms).
- Test suite updated for these changes and new features.

### Thanks
 
For catching bugs, pull requests, comments to:
- [codingfriend1](https://github.com/codingfriend1)
for [non-paginated users](https://github.com/eddyystop/feathers-service-verify-reset/issues/4).

