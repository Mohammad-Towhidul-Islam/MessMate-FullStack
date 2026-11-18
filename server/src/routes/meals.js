
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { roles } from '../middleware/auth.js';

const r = Router();

// Convert date-only query values into UTC day boundaries.
// Example: to=2026-11-30 includes the entire 30 November.
function parseDateBoundary(value, endOfDay = false) {
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const suffix = endOfDay
      ? 'T23:59:59.999Z'
      : 'T00:00:00.000Z';

    const date = new Date(`${value}${suffix}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Meal quantity supports 0.25, 0.50, 0.75, 1.00, etc.
const mealSchema = z.object({
  memberId: z.string().min(1),
  date: z.coerce.date(),
  type: z.enum(['DAY', 'NIGHT']),
  quantity: z.number()
    .min(0)
    .max(10)
    .refine(
      value => Math.abs(value * 4 - Math.round(value * 4)) < 0.0000001,
      'Meal quantity must be in increments of 0.25'
    ),
  note: z.string().max(200).optional()
});

// GET /meals?from=YYYY-MM-DD&to=YYYY-MM-DD
// Get all meals in the selected date range.
r.get('/', async (req, res) => {
  try {
    const today = new Date();

    const fromValue = req.query.from ||
      `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;

    const toValue = req.query.to ||
      today.toISOString().slice(0, 10);

    const from = parseDateBoundary(String(fromValue), false);
    const to = parseDateBoundary(String(toValue), true);

    if (!from || !to) {
      return res.status(400).json({
        error: 'Invalid date range'
      });
    }

    if (from > to) {
      return res.status(400).json({
        error: 'Start date cannot be after end date'
      });
    }

    const rows = await prisma.mealEntry.findMany({
      where: {
        messId: req.user.messId,
        date: {
          gte: from,
          lte: to
        }
      },
      include: {
        member: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [
        { date: 'asc' },
        { member: { name: 'asc' } },
        { type: 'asc' }
      ]
    });

    return res.json(rows);

  } catch (error) {
    console.error('Get meals error:', error);

    return res.status(500).json({
      error: 'Failed to load meals'
    });
  }
});

// POST /meals
// Add or update a member's meal entry.
r.post('/', async (req, res) => {
  try {
    const parsed = mealSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid meal entry',
        details: parsed.error.flatten()
      });
    }

    const data = parsed.data;

    if (!req.user?.messId || !req.user?.sub) {
      return res.status(401).json({
        error: 'Invalid user session. Please login again.'
      });
    }

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

    const settings = await prisma.messSetting.findUnique({
      where: {
        messId: req.user.messId
      }
    });

    if (
      req.user.role === 'MEMBER' &&
      !settings?.allowMemberMealEdit
    ) {
      return res.status(403).json({
        error: 'Meal editing is disabled'
      });
    }

    const meal = await prisma.mealEntry.upsert({
      where: {
        memberId_date_type: {
          memberId: data.memberId,
          date: data.date,
          type: data.type
        }
      },

      create: {
        messId: req.user.messId,
        memberId: data.memberId,
        date: data.date,
        type: data.type,
        quantity: data.quantity,
        note: data.note,
        createdBy: req.user.sub
      },

      update: {
        quantity: data.quantity,
        note: data.note
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

    return res.status(201).json(meal);

  } catch (error) {
    console.error('Save meal error:', error);

    return res.status(500).json({
      error: 'Failed to save meal'
    });
  }
});

// DELETE /meals/:id
// Delete a meal entry (Admin/Manager only).
r.delete('/:id', roles('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const meal = await prisma.mealEntry.findFirst({
      where: {
        id: req.params.id,
        messId: req.user.messId
      }
    });

    if (!meal) {
      return res.status(404).json({
        error: 'Meal entry not found'
      });
    }

    await prisma.mealEntry.delete({
      where: {
        id: meal.id
      }
    });

    return res.json({
      ok: true,
      message: 'Meal entry deleted successfully'
    });

  } catch (error) {
    console.error('Delete meal error:', error);

    return res.status(500).json({
      error: 'Failed to delete meal'
    });
  }
});

export default r;
