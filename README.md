# Formal Electrical & Maintenance website

The Node.js site and private client workspace for Formal Electrical and Maintenance (Pty) Ltd.

## Local use

Install Node.js 20 or newer. Run `npm run create-user` to create a local administrator or assigned-user account, then run `npm start`. Account password hashes and enquiry records are stored under `DATA_DIR` (default `./data`); never commit that directory or `.env` files.

## Azure App Service deployment

The workflow in `.github/workflows/deploy-azure.yml` packages the Node app and deploys it to the existing Linux App Service `formal-electrical-and-maintenace` when run manually or after a push to `main`. It requires the GitHub Actions repository secret `AZURE_WEBAPP_PUBLISH_PROFILE`. If that secret is absent, the workflow safely skips its deploy step.

For persistent account and enquiry files, set the App Service setting `DATA_DIR` to `/home/formal-em-data`. Set `ADMIN_SETUP_TOKEN` to a long random one-time value, then open `/setup.html` on the deployed site to create the first administrator. Once setup succeeds, remove `ADMIN_SETUP_TOKEN` from App Service settings. The setup route is disabled when the token is absent and permanently closes after the first account is created.

The setup password is sent directly over HTTPS to this App Service and stored as a salted scrypt hash. Do not put administrator passwords or user data in GitHub or the repository. The initial account is created in the Azure `DATA_DIR`; local `data/` is not deployed.

## Scope

The admin workspace currently supports enquiries and assigned-user account creation. Project tracking, COC certificate records, invoice creation/storage, and company settings still need their application data models and screens.
