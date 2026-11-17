
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { roles } from '../middleware/auth.js';

const r = Router();

const mealSchema = z.object({
  memberId: z.string().min(1),
  date: z.coerce.date(),
  type: z.enum(['DAY', 'NIGHT']),
  quantity: z.number().min(0).max(10),
  note: z.string().max(200).optional()
});

// Get meals for a selected date range
r.get('/', async (req, res) => {
  try {
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const to = req.query.to
      ? new Date(req.query.to)
      : new Date();

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: 'Invalid date range' });
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

    res.json(rows);
  } catch (error) {
    console.error('Get meals error:', error);
    res.status(500).json({ error: 'Failed to load meals' });
  }
});

// Add or update a meal entry
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

    const member = await prisma.member.findFirst({
      where: {
        id: data.memberId,
        messId: req.user.messId,
        active: true
      }
    });

    if (!member) {
      return res.status(404).json({
        error: 'Member not found'
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
      }
    });

    res.status(201).json(meal);

  } catch (error) {
    console.error('Save meal error:', error);
    res.status(500).json({
      error: 'Failed to save meal'
    });
  }
});

// Delete a meal entry
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

    res.json({
      ok: true,
      message: 'Meal entry deleted successfully'
    });

  } catch (error) {
    console.error('Delete meal error:', error);
    res.status(500).json({
      error: 'Failed to delete meal'
    });
  }
});

export default r;
