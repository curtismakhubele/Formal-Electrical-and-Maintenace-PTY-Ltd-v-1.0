# Formal Electrical & Maintenance website

The Node.js site and private client workspace for Formal Electrical and Maintenance (Pty) Ltd.

## Local use

Install Node.js 20 or newer. Run `npm run create-user` to create a local administrator or assigned-user account, then run `npm start`. Account password hashes and enquiry records are stored under `DATA_DIR` (default `./data`); never commit that directory or `.env` files.

## Azure App Service deployment

The workflow in `.github/workflows/deploy-azure.yml` packages the Node app and deploys it to the existing Linux App Service `formal-electrical-and-maintenace` when run manually or after a push to `main`. It uses GitHub OIDC federation with an Azure user-assigned managed identity scoped to this Web App; no publish-profile secret is needed.

For persistent account and enquiry files, set the App Service setting `DATA_DIR` to `/home/formal-em-data`. To use Azure settings for first sign-in, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 14 characters). The first successful admin sign-in hashes and saves that credential in `DATA_DIR`; this is a one-time bootstrap and does not replace a different administrator account. Remove `ADMIN_PASSWORD` from App Service settings after first sign-in. Alternatively, create the first admin with `/setup.html` and a long random `ADMIN_SETUP_TOKEN`; remove that token after setup succeeds. The setup route is disabled when the token is absent and closes after the first account is created.

The setup password is sent directly over HTTPS to this App Service and stored as a salted scrypt hash. Do not put administrator passwords or user data in GitHub or the repository. The initial account is created in the Azure `DATA_DIR`; local `data/` is not deployed.

## Scope

The admin workspace includes project tracking for Construction, Electrical, General, and Civil work; assignment to existing user accounts; in-progress and completed statuses; dated work records; COC issue records; private project and certificate files; invoice drafting and status tracking; company details and logo settings; assigned-user account creation; and website enquiries. Assigned users can view their projects, work records, certificates, documents, and related invoices in the client workspace.

Project files, COC PDFs, company logo, invoice records, project records, account hashes, and enquiries are stored under `DATA_DIR` on the App Service persistent path. Uploaded documents are limited to 7 MB; project files accept PDF, PNG, JPEG, and WebP, COC attachments accept PDF, and logos accept PNG, JPEG, and WebP. Invoice drafts are stored as structured records and can be printed or saved as PDF from the admin or client workspace.

After signing in, change the bootstrap password from Admin workspace → Settings → Change administrator password. Passwords are hashed with scrypt before storage. Use the admin workspace to create assigned-user accounts and assign them to projects.
