# Public-source release preparation

This records the checks for publishing Peakly's source. It does not approve a hosted deployment, activate payments, or release a signed Mac binary. The marketing website is maintained in the separate `GrowwSoft/peakly-website` repository.

## Checked on 2026-10-09

- The owner approved Apache-2.0 for both repositories. Each includes the license text, a project notice, and matching package metadata; the native app declares the same license.
- App unit tests: 41 passed, including authorization before credential access and before returning cached account data.
- Web and Mac frontend end-to-end tests: 26 passed. Mac tests use WebKit with a native bridge stand-in, rather than a signed application.
- Website checks: 62 passed across desktop and phone projects, including feedback isolation and donation configuration. Checkout tests use a Stripe stand-in.
- Both repositories passed TypeScript, lint, and whitespace checks. The app production build passed with Webpack; the website production build passed through its end-to-end harness.
- Production HTTP checks returned 503 when either protection was absent, 401 for missing or wrong credentials, and 200 for correctly authenticated sample-data pages.
- Production npm dependency audits reported zero advisories in both repositories.
- After refreshing remote branches and tags, a targeted credential-pattern scan examined 197 distinct reachable app Git blobs and 71 website blobs, plus publishable working files. Matches were synthetic signing fixtures, key-format validators, and test-only URL credentials. This is not an exhaustive secret scan; unfetched pull-request-only refs, GitHub discussions, and external services were outside its scope.
- No tracked environment secrets, report caches, build directories, or files over 5 MB were found. Each repository ignores generated test builds.
- The app preparation branch includes the two previously merged GitHub changes. Its added CI runs on a GitHub-hosted runner, requests read-only repository permissions, and uses no configured deployment secrets.

## Outstanding and separate gates

- Both full npm audits still report the development-only `braces` denial-of-service advisory through the Next ESLint toolchain (five dependency entries for one advisory). Do not run lint on untrusted repositories with access to deployment secrets. Recheck upstream fixes before release tooling changes; npm's proposed major downgrade is not applied.
- Rust dependency advisories and a signed native build are separate native-release checks. An offline Cargo metadata attempt could not complete because a platform dependency was not cached.
- VoteWant's shared rate limiting and its deployed identity/persistence settings need a separate release review. Peakly's mock tests do not establish that every production write is enabled or durable.
- The canonical website domain is `getpeakly.com`; set the production `SITE_URL` to `https://getpeakly.com` before enabling live donations.
- Enable GitHub private vulnerability reporting when publishing, review the owner-visible repository metadata, and decide whether issues/discussions should be enabled.
- Earlier commits contain machine-local author/committer metadata. New preparation commits use the maintainer's GitHub noreply address. Existing shared history has not been rewritten; review its metadata before changing visibility if that information should remain private.

## Rechecking

For the app, run `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run e2e`. Use the isolated test build directory when a development server is running: `GI_NEXT_DIST_DIR=.next-e2e npx next build --webpack`.

For the website, run `npm run check` from its repository. Its browser checks build an isolated production preview and use test services.

Recheck both repositories with `npm audit --omit=dev` and `npm audit`. Keep keys, `.env.local`, report data, Keychain exports, AWS credentials, and build artifacts out of commits.
