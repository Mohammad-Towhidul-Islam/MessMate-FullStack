
import { Router } from 'express';
import { prisma } from '../db.js';

const r = Router();

r.get('/', async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = Number(req.query.month) || new Date().getMonth() + 1;

    if (month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid month' });
    }

    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));

    const [members, meals, transactions] = await Promise.all([
      prisma.member.count({
        where: {
          messId: req.user.messId,
          active: true
        }
      }),

      prisma.mealEntry.findMany({
        where: {
          messId: req.user.messId,
          date: {
            gte: start,
            lt: end
          }
        }
      }),

      prisma.transaction.findMany({
        where: {
          messId: req.user.messId,
          transactionDate: {
            gte: start,
            lt: end
          },
          reversedAt: null
        }
      })
    ]);

    // Total meals
    const totalMeals = meals.reduce(
      (sum, meal) => sum + Number(meal.quantity),
      0
    );

    // Deposits
    const deposits = transactions
      .filter(t => t.type === 'DEPOSIT')
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Market expenses only
    const marketExpenses = transactions
      .filter(
        t => t.type === 'EXPENSE' && t.category === 'MARKET'
      )
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Utility expenses are separate
    const utilityExpenses = transactions
      .filter(
        t => t.type === 'EXPENSE' && t.category === 'UTILITIES'
      )
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Other expenses
    const otherExpenses = transactions
      .filter(
        t =>
          t.type === 'EXPENSE' &&
          t.category !== 'MARKET' &&
          t.category !== 'UTILITIES'
      )
      .reduce((sum, t) => sum + Number(t.amount), 0);

    // Meal rate = total market expense / total meals
    const mealRate =
      totalMeals > 0 ? marketExpenses / totalMeals : 0;

    // All expenses for cash balance
    const totalExpenses =
      marketExpenses + utilityExpenses + otherExpenses;

    const cashBalance = deposits - totalExpenses;

    res.json({
      month: `${year}-${String(month).padStart(2, '0')}`,

      members,
      totalMeals,

      deposits,

      marketExpenses,
      utilityExpenses,
      otherExpenses,
      totalExpenses,

      mealRate: Number(mealRate.toFixed(4)),

      cashBalance: Number(cashBalance.toFixed(2))
    });

  } catch (error) {
    console.error('Dashboard error:', error);

    res.status(500).json({
      error: 'Failed to load dashboard data'
    });
  }
});

export default r;
