# Security

Peakly is currently a pre-release project. Security fixes target the latest code on the default branch; older snapshots do not have a separate support schedule.

## Reporting a vulnerability

Please do not post vulnerabilities involving credentials, private reports, or exploitable details on the public feedback board. Use GitHub's private vulnerability-reporting option when it is available. Otherwise, contact the maintainer through the [one-to-one contact link](https://calendly.com/alexander-landaverde01/one-to-one) to arrange a private report. Include only a high-level description in the booking form; share sensitive details after agreeing on a private channel.

## Running Peakly

- The web app stores one App Store Connect connection per instance. Its instance-wide password is not a multi-user or tenant-isolation system.
- Production requires `GI_BASIC_AUTH` and `GI_ENCRYPTION_KEY`. Keep secrets in deployment settings, outside the repository, and serve the app over HTTPS.
- The development and production start commands bind to loopback. An externally reachable development server still requires authentication.
- The Mac app stores its saved connection in macOS Keychain. The web app encrypts saved credentials and caches reports in its server data directory.
- Feedback and comments are public, hosted by VoteWant, and separate from Apple reports. Do not submit personal, account, or report data there.

The signing keys committed under `e2e/fixtures` and the native test module are synthetic fixtures for mock services. They are not production credentials.
