# MessMate — Full-stack Mess Management
EMAIL: admin@messmate.local
Password: ChangeMe123!
https://messmate-fullstack-eight.vercel.app/
A JavaScript monorepo starter for a real mess-management workflow:
- React + Vite + Tailwind client
- Node.js + Express API
- PostgreSQL + Prisma ORM
- Zod request validation
- JWT auth, role checks, audit-friendly transaction records
- Excel-style 12-month Day/Night meal register with editable daily cells and daily market-cost row
- Deposits, expenses, member management and monthly member settlement summary

## Requirements
- Node.js 20+
- Docker Desktop (recommended) or PostgreSQL 15+
- npm

## Quick start
1. Copy `server/.env.example` to `server/.env` and set a long random `JWT_SECRET`.
2. Start PostgreSQL: `docker compose up -d db`
3. Install dependencies: `npm install`
4. Create DB schema: `npm run db:migrate`
5. Create first admin: `npm run seed`
6. Start API + client: `npm run dev`

Client: http://localhost:5173  
API: http://localhost:4000/api  
Health: http://localhost:4000/api/health

Seed login:
- Email: admin@messmate.local
- Password: ChangeMe123!
Change the password immediately for any non-demo environment.

## Project layout
- `client/` React UI
- `server/` Express API, Prisma schema and business logic
- `docker-compose.yml` local PostgreSQL
- `docs/ACCOUNTING.md` current accounting assumptions and unresolved Excel interpretation

## Excel migration
The supplied workbook has month sheets with member rows in Day/Night pairs and daily fractional values. The CSV is a month export with the same general structure. This starter does not silently import historical totals into live ledgers. First review and map the source columns using `docs/ACCOUNTING.md`; then import verified daily meal rows and deposits/expenses. Preserve the original files as read-only backups.

## Important production checklist
- Replace JWT secret and seed credentials.
- Configure HTTPS, secure cookie/session strategy, CORS allowlist and backups.
- Add a production mail provider for password reset/invitations.
- Review the accounting rules with the mess treasurer before enabling settlement.
- Run migrations and automated tests in CI before deployment.
- Never hard-delete financial records; add reversal/adjustment entries instead.

This is a runnable full-stack MVP foundation, not a claim of audited or bug-free accounting software. Validate calculations against the mess's agreed rules before using it for real payments.

## Monthly sheet behavior
The monthly grid follows the uploaded workbook layout: member name, Day/Night rows, day-number columns, daily market-cost row, member meal totals, meal cost, deposit and Due/Return. Month and year selectors provide a 12-month archive view. Meal rate is computed from recorded market expenses divided by total meal quantity. Utility bills are recorded separately and show an indicative equal split; do not treat that split as final settlement until the mess confirms its utility-sharing policy.

## Student accounts
Students can create an account from the sign-in screen using the mess invite code. The demo seed uses `MESSMATE-JOIN`; replace this with a private code before deployment and share it only with your mess members. Registration creates a linked member profile.
