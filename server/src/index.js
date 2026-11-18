
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import activityRoutes from './routes/activity.js';
import auth from './routes/auth.js';

import { auth as authenticate } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/errors.js';

import memberRoutes from './routes/members.js';
import mealRoutes from './routes/meals.js';
import transactionRoutes from './routes/transactions.js';
import dashboardRoutes from './routes/dashboard.js';

const app = express();

// =====================================
// CORS CONFIGURATION
// =====================================

const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://messmate-fullstack-eight.vercel.app'
];

if (process.env.CLIENT_ORIGIN) {
  const extraOrigins = process.env.CLIENT_ORIGIN
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  allowedOrigins.push(...extraOrigins);
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log('CORS blocked origin:', origin);
    return callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// =====================================
// SECURITY MIDDLEWARE
// =====================================

app.use(helmet());

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(morgan('combined'));

// =====================================
// PUBLIC AUTH ROUTES
// =====================================

app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: true,
    legacyHeaders: false
  }),
  auth
);

// =====================================
// PUBLIC HEALTH CHECK
// =====================================

app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'messmate-api',
    message: 'MessMate Backend is running'
  });
});

// =====================================
// PROTECTED API ROUTES
// =====================================

app.use('/api', authenticate);

app.use('/api/activity', activityRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/meals', mealRoutes);
app.use('/api/transactions', transactionRoutes);

// =====================================
// ERROR HANDLING
// =====================================

app.use(notFound);
app.use(errorHandler);

// =====================================
// LOCAL DEVELOPMENT SERVER
// =====================================

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 4000;

  app.listen(PORT, () => {
    console.log(`MessMate API listening on port ${PORT}`);
  });
}

// =====================================
// EXPORT FOR VERCEL
// =====================================

export default app;
