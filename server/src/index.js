
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { auth } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/errors.js';

import authRoutes from './routes/auth.js';
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

// Add additional origins from environment variable
if (process.env.CLIENT_ORIGIN) {
  const extraOrigins = process.env.CLIENT_ORIGIN
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  allowedOrigins.push(...extraOrigins);
}

const corsOptions = {
  origin: (origin, callback) => {

    // Allow requests without an Origin header
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log('CORS blocked origin:', origin);

    return callback(null, false);
  },

  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS'
  ],

  allowedHeaders: [
    'Content-Type',
    'Authorization'
  ]
};

// =====================================
// SECURITY MIDDLEWARE
// =====================================

app.use(helmet());

app.use(cors(corsOptions));

app.use(express.json({
  limit: '1mb'
}));

app.use(express.urlencoded({
  extended: true
}));

app.use(morgan('combined'));

// =====================================
// AUTHENTICATION ROUTES
// =====================================

app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: true,
    legacyHeaders: false
  }),
  authRoutes
);

// =====================================
// HEALTH CHECK
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

app.use('/api', auth);

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
    console.log(
      `MessMate API listening on port ${PORT}`
    );
  });

}

// =====================================
// EXPORT FOR VERCEL
// =====================================

export default app;
