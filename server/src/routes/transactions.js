
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { roles } from '../middleware/auth.js';

const r = Router();

// =====================================
// VALIDATION
// =====================================

const transactionSchema = z.object({
  type: z.enum(['DEPOSIT', 'EXPENSE', 'ADJUSTMENT']),

  memberId: z.string().min(1).optional(),

  category: z.enum([
    'MARKET',
    'UTILITIES',
    'RENT',
    'OTHER'
  ]).optional(),

  amount: z.coerce.number()
    .finite()
    .positive()
    .max(100000000),

  description: z.string()
    .trim()
    .min(2)
    .max(240),

  transactionDate: z.coerce.date(),

  reference: z.string()
    .trim()
    .max(80)
    .optional()
});

const updateSchema = z.object({
  amount: z.coerce.number()
    .finite()
    .positive()
    .max(100000000)
    .optional(),

  description: z.string()
    .trim()
    .min(2)
    .max(240)
    .optional(),

  transactionDate: z.coerce.date().optional(),

  reference: z.string()
    .trim()
    .max(80)
    .nullable()
    .optional()
}).strict().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

// =====================================
// HELPERS
// =====================================

function sendServerError(res, error, message) {
  console.error(message, error);

  return res.status(500).json({
    error: message,

    ...(process.env.NODE_ENV !== 'production'
      ? {
          details: error?.message || String(error),
          code: error?.code || null
        }
      : {})
  });
}

function getMessId(req, res) {
  if (!req.user?.messId || !req.user?.sub) {
    res.status(401).json({
      error: 'Invalid session. Please login again.'
    });

    return null;
  }

  return req.user.messId;
}

function parseDateFilter(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  return date;
}

async function verifyMember(memberId, messId) {
  if (!memberId) return true;

  const member = await prisma.member.findFirst({
    where: {
      id: memberId,
      messId,
      active: true
    },
    select: {
      id: true
    }
  });

  return Boolean(member);
}

const transactionInclude = {
  member: {
    select: {
      id: true,
      name: true
    }
  }
};

// =====================================
// GET TRANSACTIONS
// GET /api/transactions
// =====================================

r.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    const messId = getMessId(req, res);
    if (!messId) return;

    const where = {
      messId,
      reversedAt: null
    };

    if (req.query.from || req.query.to) {
      where.transactionDate = {};

      if (req.query.from) {
        const from = parseDateFilter(String(req.query.from));

        if (!from) {
          return res.status(400).json({
            error: 'Invalid start date. Use YYYY-MM-DD.'
          });
        }

        where.transactionDate.gte = from;
      }

      if (req.query.to) {
        const to = parseDateFilter(String(req.query.to));

        if (!to) {
          return res.status(400).json({
            error: 'Invalid end date. Use YYYY-MM-DD.'
          });
        }

        where.transactionDate.lte = to;
      }

      if (
        where.transactionDate.gte &&
        where.transactionDate.lte &&
        where.transactionDate.gte > where.transactionDate.lte
      ) {
        return res.status(400).json({
          error: 'Start date cannot be after end date'
        });
      }
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: transactionInclude,
      orderBy: [
        { transactionDate: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    return res.status(200).json(transactions);
  } catch (error) {
    return sendServerError(
      res,
      error,
      'Failed to load transactions'
    );
  }
});

// =====================================
// CREATE TRANSACTION
// POST /api/transactions
// ADMIN / MANAGER ONLY
// =====================================

r.post(
  '/',
  roles('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const messId = getMessId(req, res);
      if (!messId) return;

      const parsed = transactionSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid transaction',
          details: parsed.error.flatten()
        });
      }

      const data = parsed.data;

      // Deposits and adjustments require a member.
      if (
        ['DEPOSIT', 'ADJUSTMENT'].includes(data.type) &&
        !data.memberId
      ) {
        return res.status(400).json({
          error: 'A member is required for deposits and adjustments'
        });
      }

      // Expenses require a category.
      if (
        data.type === 'EXPENSE' &&
        !data.category
      ) {
        return res.status(400).json({
          error: 'Expense category is required'
        });
      }

      // Category is only valid for expenses.
      if (
        data.type !== 'EXPENSE' &&
        data.category
      ) {
        return res.status(400).json({
          error: 'Category is only allowed for expenses'
        });
      }

      // Verify member belongs to this mess.
      if (
        data.memberId &&
        !(await verifyMember(data.memberId, messId))
      ) {
        return res.status(404).json({
          error: 'Member not found or inactive'
        });
      }

      const transaction = await prisma.transaction.create({
        data: {
          messId,
          memberId: data.memberId || null,
          type: data.type,
          category: data.category || null,
          amount: data.amount,
          description: data.description,
          transactionDate: data.transactionDate,
          reference: data.reference || null,
          createdBy: req.user.sub
        },
        include: transactionInclude
      });

      return res.status(201).json({
        message: 'Transaction saved successfully',
        transaction
      });
    } catch (error) {
      return sendServerError(
        res,
        error,
        'Failed to create transaction'
      );
    }
  }
);

// =====================================
// UPDATE TRANSACTION
// PATCH /api/transactions/:id
// ADMIN / MANAGER ONLY
// =====================================

r.patch(
  '/:id',
  roles('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const messId = getMessId(req, res);
      if (!messId) return;

      const parsed = updateSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid transaction update',
          details: parsed.error.flatten()
        });
      }

      const existing = await prisma.transaction.findFirst({
        where: {
          id: req.params.id,
          messId,
          reversedAt: null
        }
      });

      if (!existing) {
        return res.status(404).json({
          error: 'Transaction not found'
        });
      }

      const updated = await prisma.transaction.updateMany({
        where: {
          id: existing.id,
          messId,
          reversedAt: null
        },
        data: parsed.data
      });

      if (updated.count !== 1) {
        return res.status(409).json({
          error: 'Transaction was changed or reversed. Refresh and try again.'
        });
      }

      const transaction = await prisma.transaction.findFirst({
        where: {
          id: existing.id,
          messId,
          reversedAt: null
        },
        include: transactionInclude
      });

      if (!transaction) {
        return res.status(409).json({
          error: 'Transaction is no longer available'
        });
      }

      return res.json({
        message: 'Transaction updated successfully',
        transaction
      });
    } catch (error) {
      return sendServerError(
        res,
        error,
        'Failed to update transaction'
      );
    }
  }
);

// =====================================
// REVERSE TRANSACTION
// POST /api/transactions/:id/reverse
// ADMIN ONLY
// =====================================

r.post(
  '/:id/reverse',
  roles('ADMIN'),
  async (req, res) => {
    try {
      const messId = getMessId(req, res);
      if (!messId) return;

      const existing = await prisma.transaction.findFirst({
        where: {
          id: req.params.id,
          messId,
          reversedAt: null
        },
        select: {
          id: true
        }
      });

      if (!existing) {
        return res.status(404).json({
          error: 'Transaction not found or already reversed'
        });
      }

      const result = await prisma.transaction.updateMany({
        where: {
          id: existing.id,
          messId,
          reversedAt: null
        },
        data: {
          reversedAt: new Date()
        }
      });

      if (result.count !== 1) {
        return res.status(409).json({
          error: 'Transaction was already changed. Refresh and try again.'
        });
      }

      return res.json({
        ok: true,
        message: 'Transaction reversed successfully'
      });
    } catch (error) {
      return sendServerError(
        res,
        error,
        'Failed to reverse transaction'
      );
    }
  }
);

export default r;
