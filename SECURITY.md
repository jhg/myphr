# Security Policy

## Supported Versions

This project does not use version numbers: it is an MVP built for a hackathon and is developed
directly on `main`. Only the latest commit on `main` is supported with security fixes.

| Version              | Supported          |
| --------------------- | ------------------ |
| Latest commit on `main` | :white_check_mark: |
| Anything older         | :x:                |

## Reporting a Vulnerability

Please report vulnerabilities by email to **contact@lenorix.com**, rather than opening a public
issue.

Include as much detail as you can: affected component, steps to reproduce, and potential impact.
Given the nature of the project (an end-to-end encrypted personal health record), please flag
clearly if the report touches the cryptographic design (OPAQUE, envelope encryption, or the
shared-clipping flow) so it can be prioritized accordingly.

We will acknowledge reports as soon as possible. Since this is a small, actively developed MVP
without a fixed release cadence, there is no formal SLA on response times, but valid reports will
be fixed on `main` and you will be kept informed of progress.
