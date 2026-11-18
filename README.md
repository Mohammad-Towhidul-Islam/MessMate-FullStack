Live Website: https://messmate-fullstack-eight.vercel.app/

MessMate is a full-stack web-based mess management platform designed to simplify daily meal tracking, market expenses, member management, deposits, and monthly financial settlements.
- Email: admin@messmate.local
- Password: ChangeMe123!
Security Notice: These are demo seed credentials. Change the password immediately before using the application in a real environment.
- User Authentication: JWT-based authentication with role-based access control.
- Member Management: Manage mess members and their accounts.
- Daily Meal Tracking: Excel-style 12-month Day/Night meal register.
- Market Expense Management: Record daily market costs.
- Deposit Management: Track member deposits and balances.
- Transaction Management: Manage expenses and financial transactions.
- Monthly Settlement: Calculate meal costs, member expenses, Due, and Return.
- Historical Records: View monthly meal and accounting records.
- Student Registration: Students can register using a mess invitation code.
- Data Validation: Zod-based request validation.
- Audit-Friendly Records: Financial transactions support adjustment and reversal workflows.
Component	Technology
Frontend	React, Vite, Tailwind CSS
Backend	Node.js, Express.js
Database	PostgreSQL
ORM	Prisma
Authentication	JWT
Validation	Zod
Package Manager	npm
```
MessMate/
│
├── client/              # React frontend
├── server/              # Express backend and API
│   ├── prisma/          # Database schema
│   └── ...
│
├── docs/
│   └── ACCOUNTING.md    # Accounting rules and assumptions
│
├── docker-compose.yml
└── package.json
```
- Node.js 20+
- npm
- Docker Desktop (recommended) or PostgreSQL 15+
```
git clone https://github.com/Mohammad-Towhidul-Islam/MessMate-FullStack.git

cd MessMate-FullStack
```
Copy:
```
server/.env.example
```
to:
```
server/.env
```
Configure your database connection and a strong, randomly generated JWT_SECRET.
```
docker compose up -d db
```
```
npm install
```
```
npm run db:migrate
```
```
npm run seed
```
```
npm run dev
```
Local Application URLs
- Frontend: http://localhost:5173
- Backend API: http://localhost:4000/api
- API Health: http://localhost:4000/api/health
The monthly meal register follows an Excel-style structure with:
- Member names
- Day and Night meal entries
- Daily meal quantities
- Daily market costs
- Individual meal totals
- Meal rates
- Member deposits
- Due and Return calculations
Users can select a month and year to access the 12-month historical archive.

The meal rate is calculated using recorded market expenses divided by total meal quantity.
Students can create accounts from the sign-in page using a mess invitation code.

Demo Invitation Code: MESSMATE-JOIN

Registration automatically creates a linked member profile.

For production use, replace the demo invitation code with a private code and share it only with authorized mess members.
- Historical Excel data should be reviewed before importing.
- Original Excel files should be preserved as read-only backups.
- Financial records should not be hard-deleted.
- Reversal and adjustment entries should be used for corrections.
- Utility bill splitting is indicative and should not be considered final until the mess agrees on its sharing policy.
- All settlement calculations should be verified against the mess's agreed accounting rules.
Before using MessMate in a real environment:
1. Replace demo admin credentials.
2. Configure a strong production JWT secret.
3. Enable HTTPS.
4. Configure secure authentication and session handling.
5. Set a restricted CORS allowlist.
6. Configure database backups.
7. Add an email provider for password resets and invitations.
8. Run database migrations and automated tests in CI.
9. Verify accounting calculations with the mess treasurer.
MessMate is a runnable full-stack MVP foundation.

It provides the core workflows for mess management, meal tracking, expense monitoring, member accounts, and monthly settlements. It is not an audited accounting system, so financial calculations should be validated before real-world use.
Developed as a Full-Stack Web Application Project.
