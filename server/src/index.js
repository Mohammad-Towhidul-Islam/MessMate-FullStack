
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

// Security and middleware
app.use(helmet());

app.use(cors({
  origin: process.env.CLIENT_ORIGIN?.split(',') || 'http://localhost:5173'
}));

app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

// Authentication routes
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50
  }),
  authRoutes
);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'messmate-api'
  });
});

// Protected routes
app.use('/api', auth);

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/meals', mealRoutes);
app.use('/api/transactions', transactionRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Local development server
if (!process.env.VERCEL) {
  const port = process.env.PORT || 4000;

  app.listen(port, () => {
    console.log(`MessMate API listening on ${port}`);
  });
}

// Export Express app for Vercel
export default app;
