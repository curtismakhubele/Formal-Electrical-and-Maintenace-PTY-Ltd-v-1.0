# Formal Electrical & Maintenance

A responsive company website and real enquiry intake service for Formal Electrical and Maintenance (Pty) Ltd.

## Run locally

Requires Node.js 20 or newer. The app uses Node's built-in modules and has no package-install step.

```powershell
node server.js
```

Open `http://localhost:3000`. The health endpoint is `http://localhost:3000/api/health`.

Project enquiries are validated and appended to `data/enquiries.jsonl`. Keep that directory private and back it up. The site gives a success response only after the enquiry is saved. A small in-memory per-IP limit and a hidden bot-trap field reduce automated submissions. The private workspace at `/admin.html` allows a designated administrator to review the latest 500 enquiries with a secret `ADMIN_TOKEN`.

## Production hosting

This app includes a Node server; GitHub Pages can serve the static design but cannot run `/api/enquiries`. To enable the working form, deploy the repository to a Node.js host with:

- Node.js 20 or newer and the start command `node server.js`
- HTTPS and a persistent private volume mounted for `DATA_DIR`
- `PORT` set by the host, or defaulting to `3000`
- A unique random `ADMIN_TOKEN` of at least 32 characters, stored as a host secret
- `TRUST_PROXY_HOPS` set to the exact number of trusted reverse-proxy hops when the host supplies `X-Forwarded-For`; leave it at `0` otherwise
- Regular encrypted backups and a documented retention process for enquiry records

Set `DATA_DIR` to the mounted persistent volume. Generate an access token with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, then save it as a host secret. Do not store it in source control. The enquiry file contains personal contact details, is never served as a static asset, and must not be committed. An authorised administrator can open `/admin.html` and enter the token; it remains in that browser tab's session storage until sign-out or tab closure. If the host sits behind a trusted reverse proxy, configure the exact number of proxy hops so request throttling can distinguish visitors; never trust forwarded headers from an untrusted client.

The prior role selector and sample business dashboard have been removed. This release does not claim to provide accounts, work orders, quotations, a CRM or client portal. Those need an approved backend, access model and operating procedures before they are introduced.

## Before a public business launch

- Confirm the company's official public phone, email and street address. They were not present in the repository source, so the site uses only the Pretoria/Gauteng service area.
- Decide who monitors the saved enquiry records and how quickly enquiries should be answered.
- Review the privacy notice against the selected host, retention period and actual data handling process.
- Verify company history, registrations, authorisations and service claims before adding them.
- Deploy to a Node host. The existing GitHub Pages deployment cannot run the enquiry API.

