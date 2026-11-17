
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { roles } from '../middleware/auth.js';

const r = Router();

// Transaction validation
const transactionSchema = z.object({
  type: z.enum(['DEPOSIT', 'EXPENSE', 'ADJUSTMENT']),
  memberId: z.string().optional(),
  category: z.enum(['MARKET', 'UTILITIES', 'RENT', 'OTHER']).optional(),
  amount: z.number().positive().max(100000000),
  description: z.string().trim().min(2).max(240),
  transactionDate: z.coerce.date(),
  reference: z.string().max(80).optional()
});

// Helper: detailed errors only in development
function sendServerError(res, error, message) {
  console.error(message, error);

  const response = {
    error: message,
    ...(process.env.NODE_ENV !== 'production'
      ? {
          details: error?.message || String(error),
          code: error?.code || null
        }
      : {})
  };

  return res.status(500).json(response);
}

// GET /transactions
r.get('/', async (req, res) => {
  try {
    const where = {
      messId: req.user.messId,
      reversedAt: null
    };

    if (req.query.from || req.query.to) {
      where.transactionDate = {};

      if (req.query.from) {
        const from = new Date(req.query.from);

        if (Number.isNaN(from.getTime())) {
          return res.status(400).json({
            error: 'Invalid start date'
          });
        }

        where.transactionDate.gte = from;
      }

      if (req.query.to) {
        const to = new Date(req.query.to);

        if (Number.isNaN(to.getTime())) {
          return res.status(400).json({
            error: 'Invalid end date'
          });
        }

        where.transactionDate.lte = to;
      }
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        member: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [
        { transactionDate: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    return res.json(transactions);

  } catch (error) {
    return sendServerError(
      res,
      error,
      'Failed to load transactions'
    );
  }
});

// POST /transactions
// Add deposit, market expense, utility bill or adjustment
r.post('/', roles('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const parsed = transactionSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid transaction',
        details: parsed.error.flatten()
      });
    }

    const data = parsed.data;

    // Verify authenticated user information
    if (!req.user?.sub || !req.user?.messId) {
      return res.status(401).json({
        error: 'Invalid user session. Please login again.'
      });
    }

    // Deposits and adjustments require a member
    if (
      (data.type === 'DEPOSIT' || data.type === 'ADJUSTMENT') &&
      !data.memberId
    ) {
      return res.status(400).json({
        error: 'A member is required for deposits and adjustments'
      });
    }

    // Expenses require a category
    if (data.type === 'EXPENSE' && !data.category) {
      return res.status(400).json({
        error: 'Expense category is required'
      });
    }

    // Non-expenses cannot have expense categories
    if (data.type !== 'EXPENSE' && data.category) {
      return res.status(400).json({
        error: 'Category is only allowed for expenses'
      });
    }

    // Check member belongs to this mess
    if (data.memberId) {
      const member = await prisma.member.findFirst({
        where: {
          id: data.memberId,
          messId: req.user.messId,
          active: true
        }
      });

      if (!member) {
        return res.status(404).json({
          error: 'Member not found or inactive'
        });
      }
    }

    // Create transaction
    const transaction = await prisma.transaction.create({
      data: {
        type: data.type,
        memberId: data.memberId || null,
        category: data.category || null,
        amount: data.amount,
        description: data.description,
        transactionDate: data.transactionDate,
        reference: data.reference || null,
        messId: req.user.messId,
        createdBy: req.user.sub
      },
      include: {
        member: {
          select: {
            id: true,
            name: true
          }
        }
      }
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
});

// PATCH /transactions/:id
// Edit transaction
r.patch('/:id', roles('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const updateSchema = z.object({
      amount: z.number().positive().max(100000000).optional(),
      description: z.string().trim().min(2).max(240).optional(),
      transactionDate: z.coerce.date().optional(),
      reference: z.string().max(80).optional()
    }).refine(
      data => Object.keys(data).length > 0,
      { message: 'At least one field is required' }
    );

    const parsed = updateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid transaction update',
        details: parsed.error.flatten()
      });
    }

    const transaction = await prisma.transaction.findFirst({
      where: {
        id: req.params.id,
        messId: req.user.messId,
        reversedAt: null
      }
    });

    if (!transaction) {
      return res.status(404).json({
        error: 'Transaction not found'
      });
    }

    const updated = await prisma.transaction.update({
      where: {
        id: transaction.id
      },
      data: parsed.data,
      include: {
        member: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return res.json(updated);

  } catch (error) {
    return sendServerError(
      res,
      error,
      'Failed to update transaction'
    );
  }
});

// POST /transactions/:id/reverse
// Reverse transaction instead of permanently deleting it
r.post('/:id/reverse', roles('ADMIN'), async (req, res) => {
  try {
    const transaction = await prisma.transaction.findFirst({
      where: {
        id: req.params.id,
        messId: req.user.messId,
        reversedAt: null
      }
    });

    if (!transaction) {
      return res.status(404).json({
        error: 'Transaction not found'
      });
    }

    await prisma.transaction.update({
      where: {
        id: transaction.id
      },
      data: {
        reversedAt: new Date()
      }
    });

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
});

export default r;
