# Universal / App Links

These two files are what let `https://snapduka.shop/dashboard/orders/…` open the
seller app instead of the browser. Both are served from the site root, and both
still contain a placeholder that must be replaced before links will verify.

## `apple-app-site-association`

Replace `TEAMID` with the Apple Developer Team ID (App Store Connect →
Membership). Serve it as `application/json`, with **no** `.json` extension and
no redirect — iOS fetches it exactly once at install time over TLS and gives up
silently on anything unexpected, which is why this fails so often without a
visible error.

## `assetlinks.json`

Replace `REPLACE_WITH_UPLOAD_KEY_SHA256` with the SHA-256 fingerprint of the
signing key Google Play actually uses. With Play App Signing that is the *app
signing* key, not your upload key:

    Play Console → Setup → App integrity → App signing key certificate

Using the upload key fingerprint is the usual mistake: links verify in an
internal-testing build and stop working the moment Play re-signs the release.

Verify after deploying:

    curl -sS https://snapduka.shop/.well-known/apple-app-site-association | jq .
    curl -sS https://snapduka.shop/.well-known/assetlinks.json | jq .
