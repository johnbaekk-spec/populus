# Security Policy

## Supported branch

Only `main` is supported. Production deployments of
[publicfilings.org](https://publicfilings.org) are built exclusively from
reviewed commits on `main`; no other branch or tag receives fixes.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub's private
vulnerability reporting:

> https://github.com/johnbaekk-spec/populus/security/advisories/new

**Do not open a public issue, discussion, or pull request** describing a
vulnerability before it is fixed. Public filing data on this site is
intentionally public; a report about how the site or its pipeline can be
compromised is not, until remediated.

## What to expect

- Acknowledgment within **14 days** of a report.
- A remediation plan or a reasoned disposition after triage, with status
  updates through the advisory thread.
- Credit in the advisory if you want it.

## Scope

- **In scope:** this repository's code, its GitHub Actions workflows, the
  static-site build and deployment pipeline, and the served site's response
  headers/content-injection surfaces.
- **Out of scope / not secrets:** the public filing data itself, the public
  government source URLs, the SEC-required contact address, and documented
  security architecture. These are intentionally public and are not
  vulnerabilities.

## Proof-of-concept guidance

**Never send a live credential, token, or secret value as proof.** If you
believe a credential is exposed, report *where* it is exposed (file, ref,
log, URL) and how you found it — the maintainers will verify and rotate it.
Sending the value itself only widens the exposure.
