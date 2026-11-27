# Formal Electrical and Maintenance (Pty) Ltd — Website + PWA starter

## Included
- Responsive corporate website in navy, gold and white
- Service, company, project approach and enquiry sections
- Installable Progressive Web App (PWA) manifest, icon and offline shell cache
- Business portal UI with Admin, Manager, Technician and Client role selection
- Demo modules: overview, work orders, projects, clients, assets, quotations and reports
- Minimal Node/Express API starter and health endpoint

## Run locally
1. Install Node.js 18 or newer.
2. In this folder run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

For mobile installation, deploy behind HTTPS, open the site in Chrome on Android, then choose **Install app** or **Add to Home screen**. iPhone users can use Safari → Share → Add to Home Screen.

## Important production work still required
This is a working front-end/PWA starter, not a production business system. The portal is a demonstration and does not authenticate users. Do not enter confidential client or company data.
Before production:
- Implement secure authentication and role-based permissions (Admin, Manager, Technician, Client).
- Add PostgreSQL schema and persistent storage for users, clients, projects, work orders, assets, stock, quotations and reports.
- Add server-side validation, password hashing, MFA option, rate limiting, audit logs, backups and HTTPS.
- Connect enquiry form to `/api/enquiries`, a database and an authorised email/CRM notification.
- Implement file uploads with malware scanning and access controls.
- Verify company address, contact details, registration number, tax/VAT details, CIDB/electrical registrations, insurance, certifications and claims before publication or tender use.
- Replace illustrative/sample content with verified company projects, staff profiles and approved photographs.
- Add privacy policy, POPIA notice, terms, cookie notice and retention schedule.

## Suggested domain names
Check availability and trademark conflicts before purchasing:
- `formalelectrical.co.za`
- `formalelectricalandmaintenance.co.za`
- `formalem.co.za`
- `formalelectrical.co.za` is a concise first choice if available.

Use a South African registrar (for example, xneelo, Afrihost or Domains.co.za) to check `.co.za` availability. The package does not register a domain or include hosting.

## Suggested first release roles
- Admin: full system configuration, users, financial and operational records
- Manager: projects, quotations, procurement, reporting and team allocation
- Technician: assigned jobs, checklists, photos, materials and job completion
- Client: own enquiries, quotations, project updates and service requests

## Contact details
The provided company listing gives the address as 4 S P Kwakwa St, Sualsvile, Pretoria, Gauteng 0125, South Africa. Phone and email were masked in the supplied source; add verified public contact details before launch.
