
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { roles } from '../middleware/auth.js';

const router = Router();

// =====================================
// VALIDATION
// =====================================

const mealSchema = z.object({
  memberId: z.string().min(1),
  date: z.string().min(1),
  type: z.enum(['DAY', 'NIGHT']),
  quantity: z.coerce.number().min(0).max(10),
  note: z.string().max(500).nullable().optional()
});

// =====================================
// HELPERS
// =====================================

function parseDate(value) {
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

function makeSnapshot(meal) {
  if (!meal) return null;

  return {
    id: meal.id,
    messId: meal.messId,
    memberId: meal.memberId,
    date: meal.date.toISOString(),
    type: meal.type,
    quantity: Number(meal.quantity),
    note: meal.note ?? null,
    createdBy: meal.createdBy,
    createdAt: meal.createdAt.toISOString(),
    updatedAt: meal.updatedAt.toISOString(),
    version: meal.version ?? 0
  };
}

async function writeAudit(tx, req, action, entityId, metadata) {
  return tx.auditLog.create({
    data: {
      messId: req.user.messId,
      userId: req.user.sub,
      action,
      entity: 'MEAL',
      entityId,
      metadata
    }
  });
}

function canManageMeals(user) {
  return ['ADMIN', 'MANAGER'].includes(user.role);
}

function mealUniqueWhere(memberId, date, type) {
  return {
    memberId_date_type: {
      memberId,
      date,
      type
    }
  };
}

function sendConflict(res, message) {
  return res.status(409).json({
    error: message || 'Meal was changed by another request. Please refresh and try again.'
  });
}

// =====================================
// GET MEALS
// =====================================

router.get('/', async (req, res, next) => {
  try {
    const { from, to } = req.query;

    const where = {
      messId: req.user.messId
    };

    if (from || to) {
      where.date = {};

      if (from) {
        const fromDate = parseDate(String(from));

        if (!fromDate) {
          return res.status(400).json({
            error: 'Invalid from date'
          });
        }

        where.date.gte = fromDate;
      }

      if (to) {
        const toDate = parseDate(String(to));

        if (!toDate) {
          return res.status(400).json({
            error: 'Invalid to date'
          });
        }

        where.date.lte = toDate;
      }

      if (
        where.date.gte &&
        where.date.lte &&
        where.date.gte > where.date.lte
      ) {
        return res.status(400).json({
          error: 'From date cannot be after to date'
        });
      }
    }

    const meals = await prisma.mealEntry.findMany({
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
        { date: 'asc' },
        { member: { name: 'asc' } },
        { type: 'asc' }
      ]
    });

    res.json(meals);
  } catch (error) {
    next(error);
  }
});

// =====================================
// CREATE OR UPDATE MEAL
// =====================================

router.post('/', async (req, res, next) => {
  try {
    const parsed = mealSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid meal data',
        details: parsed.error.flatten()
      });
    }

    const {
      memberId,
      date,
      type,
      quantity,
      note
    } = parsed.data;

    const mealDate = parseDate(date);

    if (!mealDate) {
      return res.status(400).json({
        error: 'Invalid meal date'
      });
    }

    // Check active member and mess ownership.
    const member = await prisma.member.findFirst({
      where: {
        id: memberId,
        messId: req.user.messId,
        active: true
      }
    });

    if (!member) {
      return res.status(404).json({
        error: 'Active member not found'
      });
    }

    // Members can edit only their own meals when enabled.
    if (!canManageMeals(req.user)) {
      const setting = await prisma.messSetting.findUnique({
        where: {
          messId: req.user.messId
        }
      });

      if (
        !setting?.allowMemberMealEdit ||
        member.userId !== req.user.sub
      ) {
        return res.status(403).json({
          error: 'You are not allowed to edit this meal'
        });
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.mealEntry.findUnique({
          where: mealUniqueWhere(memberId, mealDate, type)
        });

        const before = makeSnapshot(existing);

        // ---------------------------------
        // EXISTING MEAL: UPDATE
        // ---------------------------------

        if (existing) {
          const unchanged =
            Number(existing.quantity) === quantity &&
            (existing.note ?? null) === (note ?? null);

          if (unchanged) {
            return tx.mealEntry.findUnique({
              where: {
                id: existing.id
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
          }

          // Optimistic concurrency control.
          // Only update if the version is still the same.
          const updated = await tx.mealEntry.updateMany({
            where: {
              id: existing.id,
              messId: req.user.messId,
              version: existing.version
            },
            data: {
              quantity,
              note: note ?? null,
              version: {
                increment: 1
              }
            }
          });

          if (updated.count !== 1) {
            const error = new Error(
              'Meal was changed by another user. Refresh and try again.'
            );

            error.status = 409;
            throw error;
          }
        }

        // ---------------------------------
        // NEW MEAL: CREATE
        // ---------------------------------

        else {
          await tx.mealEntry.create({
            data: {
              messId: req.user.messId,
              memberId,
              date: mealDate,
              type,
              quantity,
              note: note ?? null,
              createdBy: req.user.sub,
              version: 0
            }
          });
        }

        // ---------------------------------
        // GET SAVED MEAL
        // ---------------------------------

        const savedMeal = await tx.mealEntry.findUnique({
          where: mealUniqueWhere(memberId, mealDate, type),
          include: {
            member: {
              select: {
                id: true,
                name: true
              }
            }
          }
        });

        if (!savedMeal) {
          throw new Error('Unable to retrieve saved meal');
        }

        const after = makeSnapshot(savedMeal);

        // ---------------------------------
        // WRITE ACTIVITY HISTORY
        // ---------------------------------

        await writeAudit(
          tx,
          req,
          before ? 'UPDATE' : 'CREATE',
          savedMeal.id,
          {
            before,
            after,
            beforeVersion: before?.version ?? null,
            afterVersion: after.version
          }
        );

        return savedMeal;
      },
      {
        isolationLevel: 'Serializable'
      }
    );

    res.status(200).json(result);
  } catch (error) {
    if (
      error.code === 'P2002' ||
      error.code === 'P2034' ||
      error.status === 409
    ) {
      return sendConflict(
        res,
        'Meal was changed by another request. Refresh and try again.'
      );
    }

    next(error);
  }
});

// =====================================
// DELETE MEAL
// ADMIN / MANAGER ONLY
// =====================================

router.delete(
  '/:id',
  roles('ADMIN', 'MANAGER'),
  async (req, res, next) => {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const meal = await tx.mealEntry.findFirst({
            where: {
              id: req.params.id,
              messId: req.user.messId
            }
          });

          if (!meal) {
            return null;
          }

          const before = makeSnapshot(meal);

          // Delete only if the version has not changed.
          const deleted = await tx.mealEntry.deleteMany({
            where: {
              id: meal.id,
              messId: req.user.messId,
              version: meal.version
            }
          });

          if (deleted.count !== 1) {
            const error = new Error(
              'Meal was changed by another user. Refresh and try again.'
            );

            error.status = 409;
            throw error;
          }

          // Record deletion in activity history.
          await writeAudit(
            tx,
            req,
            'DELETE',
            meal.id,
            {
              before,
              after: null,
              beforeVersion: meal.version,
              afterVersion: null
            }
          );

          return meal;
        },
        {
          isolationLevel: 'Serializable'
        }
      );

      if (!result) {
        return res.status(404).json({
          error: 'Meal not found'
        });
      }

      res.json({
        message: 'Meal deleted. It can be restored from Activity History.'
      });
    } catch (error) {
      if (
        error.code === 'P2034' ||
        error.status === 409
      ) {
        return sendConflict(
          res,
          'Meal was changed by another request. Refresh and try again.'
        );
      }

      next(error);
    }
  }
);

// =====================================
// RESTORE DELETED MEAL
// ADMIN / MANAGER ONLY
// =====================================

router.post(
  '/:id/restore',
  roles('ADMIN', 'MANAGER'),
  async (req, res, next) => {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const deleteLog = await tx.auditLog.findFirst({
            where: {
              messId: req.user.messId,
              entity: 'MEAL',
              entityId: req.params.id,
              action: 'DELETE'
            },
            orderBy: [
              { createdAt: 'desc' },
              { id: 'desc' }
            ]
          });

          if (!deleteLog?.metadata?.before) {
            return {
              error: 'No deleted meal record found',
              status: 404
            };
          }

          const data = deleteLog.metadata.before;

          // Check if the meal already exists.
          const existing = await tx.mealEntry.findUnique({
            where: mealUniqueWhere(
              data.memberId,
              new Date(data.date),
              data.type
            )
          });

          if (existing) {
            return {
              error: 'A meal already exists for this member, date and type',
              status: 409
            };
          }

          // Check member still belongs to this mess.
          const member = await tx.member.findFirst({
            where: {
              id: data.memberId,
              messId: req.user.messId
            }
          });

          if (!member) {
            return {
              error: 'Member no longer exists',
              status: 404
            };
          }

          // Recreate the deleted meal.
          const restored = await tx.mealEntry.create({
            data: {
              id: data.id,
              messId: req.user.messId,
              memberId: data.memberId,
              date: new Date(data.date),
              type: data.type,
              quantity: data.quantity,
              note: data.note ?? null,
              createdBy: data.createdBy,
              version: (data.version ?? 0) + 1
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

          // Every restore gets a new history entry.
          await writeAudit(
            tx,
            req,
            'RESTORE',
            restored.id,
            {
              before: null,
              after: makeSnapshot(restored),
              beforeVersion: null,
              afterVersion: restored.version,
              restoredFromAuditLogId: deleteLog.id
            }
          );

          return {
            meal: restored
          };
        },
        {
          isolationLevel: 'Serializable'
        }
      );

      if (result.error) {
        return res.status(result.status).json({
          error: result.error
        });
      }

      res.json({
        message: 'Meal restored successfully',
        meal: result.meal
      });
    } catch (error) {
      if (
        error.code === 'P2002' ||
        error.code === 'P2034'
      ) {
        return sendConflict(
          res,
          'A conflicting meal operation occurred. Refresh and try again.'
        );
      }

      next(error);
    }
  }
);

export default router;
