# myphr

> MVP built for the CubePath hackathon.

An end-to-end encrypted personal health record (PHR), built with Laravel, Filament and Livewire.

The server never sees your password or your health data in the clear. Sign-in uses
[OPAQUE](https://www.rfc-editor.org/rfc/rfc9807.txt) (an aPAKE: the password never leaves the browser),
and every record is encrypted in the browser with a master key the server cannot read. The reasoning
behind each decision lives in `docs/`, not here. This README is only the front door.

## Documentation

The documents below are written in Spanish.

- [`docs/README.md`](docs/README.md): what a PHR is, what this project is for, and the clinical
  vocabulary it uses (LOINC / SNOMED CT).
- [`docs/OPAQUE.md`](docs/OPAQUE.md): the full specification of password authentication without ever
  sending the password.
- [`docs/adr/`](docs/adr/): architecture decisions, with their context and their trade-offs. When a
  decision changes, we update the same file instead of adding a new one that replaces it.
- [`docs/specs/`](docs/specs/): implementation detail for each feature, built on top of those ADRs.

## Stack

- PHP 8.4 or 8.5, Laravel 13, Filament 5, Livewire 4. Both PHP versions run in CI: development uses
  8.4 and production runs 8.5.
- OPAQUE client: [`@serenity-kit/opaque`](https://github.com/serenity-kit/opaque) (exact version pinned,
  see `docs/OPAQUE.md` §3).
- Pest 4 for the PHP suite, including `arch()` tests. The JavaScript crypto modules use Node's built-in
  test runner, so there is no extra test dependency to install.
- Pint for PHP formatting.

## Getting started

```bash
composer setup
```

This installs the PHP and JavaScript dependencies, copies `.env`, generates the `APP_KEY`, runs the
migrations and builds the assets. After that, and before anyone can sign up, you need to generate the
server's static cryptographic material:

```bash
php artisan opaque:setup
```

The command prints the OPAQUE key pair and the other static secrets to the terminal. You copy them into
`.env` by hand: it does not write the file for you. Run it only once. Running it again on an
installation that already has accounts locks every one of them out, with no way to recover them.

There are two ways to create an account (ADR 0009). Anyone can sign up at `/phr/register`, and you can
also issue a single-use link. The link is how you create the first account, before the panel is
reachable:

```bash
php artisan phr:issue-registration-link someone@example.com --name="Their name"
```

The link is shown once in the terminal and the application never emails it (see
`docs/adr/0009-user-provisioning-and-session-lifecycle.md`). The person opens it, chooses a password,
and their master key is created right then, in their browser.

For local development, with the server, queue, logs and Vite running in a single process:

```bash
composer dev
```

## Tests

```bash
composer test
```

This runs the full Pest suite, including the official RFC 9497 / 9807 test vectors and the architecture
tests (session handling, `#[Url]` properties, encrypted payloads). For the JavaScript crypto modules:

```bash
npm test
```

Both suites, plus Pint, also run on every push through
[GitHub Actions](.github/workflows/tests.yml).

## Project conventions

The coding guidelines for AI agents (Laravel Boost, Pest, Filament, and so on) live in `CLAUDE.md` and
`.ai/`. Any change to the architecture, the domain or the behaviour that affects an already documented
decision is recorded by updating the matching ADR or spec, never by adding a new one that replaces it.

## Licence

This project is released into the public domain under [The Unlicense](LICENSE). You can copy it, modify
it and use it for anything, commercial or not, without asking and without giving credit.

One caveat, and it is not ours to waive: the clinical vocabulary in the catalog comes from third parties
with their own terms, and those still apply. They are listed in [`NOTICE`](NOTICE) and explained in
[ADR 0005](docs/adr/0005-clinical-vocabulary-loinc-snomed.md). LOINC in particular requires that its
attribution notice is kept.
