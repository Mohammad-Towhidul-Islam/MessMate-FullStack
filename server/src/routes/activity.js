
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';

const router = Router();

// =====================================
// VALIDATION
// =====================================

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  entity: z.string().optional(),
  action: z.string().optional()
});

// =====================================
// HELPERS
// =====================================

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

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hasSnapshot(metadata, key) {
  return (
    metadata &&
    Object.prototype.hasOwnProperty.call(metadata, key)
  );
}

function getSnapshot(metadata, key) {
  return metadata[key];
}

// Compare the actual meal data.
// Version is checked separately.
function sameMealState(a, b) {
  if (!a || !b) {
    return a === b;
  }

  return (
    a.id === b.id &&
    (!a.messId || !b.messId || a.messId === b.messId) &&
    a.memberId === b.memberId &&
    new Date(a.date).getTime() ===
      new Date(b.date).getTime() &&
    a.type === b.type &&
    Number(a.quantity) === Number(b.quantity) &&
    (a.note ?? null) === (b.note ?? null) &&
    a.createdBy === b.createdBy
  );
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

// =====================================
// APPLY SAFE MEAL TRANSITION
// =====================================

async function applyTransition(
  tx,
  messId,
  expectedState,
  expectedVersion,
  targetState
) {
  const mealId = expectedState?.id || targetState?.id;

  if (!mealId) {
    throw conflict('Invalid meal history record.');
  }

  // Always scope the meal to the current mess.
  const current = await tx.mealEntry.findFirst({
    where: {
      id: mealId,
      messId
    }
  });

  const currentSnapshot = makeSnapshot(current);

  // Verify that the current state is exactly the state
  // produced by the activity we are trying to reverse.
  if (!sameMealState(currentSnapshot, expectedState)) {
    throw conflict(
      'This meal has changed since the activity. Undo/Redo is no longer safe.'
    );
  }

  // Check optimistic concurrency version.
  if (current) {
    if (
      expectedVersion !== null &&
      expectedVersion !== undefined &&
      current.version !== expectedVersion
    ) {
      throw conflict(
        'Meal version mismatch. Someone may have changed this meal.'
      );
    }
  }

  // ---------------------------------
  // TARGET NULL: DELETE MEAL
  // ---------------------------------

  if (targetState === null) {
    if (!current) {
      throw conflict('The meal is already deleted.');
    }

    const deleted = await tx.mealEntry.deleteMany({
      where: {
        id: current.id,
        messId,
        version: current.version
      }
    });

    if (deleted.count !== 1) {
      throw conflict(
        'Meal changed during this operation. Refresh and retry.'
      );
    }

    return null;
  }

  // ---------------------------------
  // CURRENT NULL: RECREATE MEAL
  // ---------------------------------

  if (!current) {
    const member = await tx.member.findFirst({
      where: {
        id: targetState.memberId,
        messId
      }
    });

    if (!member) {
      throw conflict(
        'The original member no longer exists in this mess.'
      );
    }

    const created = await tx.mealEntry.create({
      data: {
        id: targetState.id,
        messId,
        memberId: targetState.memberId,
        date: new Date(targetState.date),
        type: targetState.type,
        quantity: Number(targetState.quantity),
        note: targetState.note ?? null,
        createdBy: targetState.createdBy,
        version: (targetState.version ?? 0) + 1
      }
    });

    return makeSnapshot(created);
  }

  // ---------------------------------
  // UPDATE EXISTING MEAL
  // ---------------------------------

  const updated = await tx.mealEntry.updateMany({
    where: {
      id: current.id,
      messId,
      version: current.version
    },
    data: {
      memberId: targetState.memberId,
      date: new Date(targetState.date),
      type: targetState.type,
      quantity: Number(targetState.quantity),
      note: targetState.note ?? null,
      createdBy: targetState.createdBy,
      version: {
        increment: 1
      }
    }
  });

  if (updated.count !== 1) {
    throw conflict(
      'Meal changed during this operation. Refresh and retry.'
    );
  }

  const saved = await tx.mealEntry.findFirst({
    where: {
      id: current.id,
      messId
    }
  });

  return makeSnapshot(saved);
}

// =====================================
// GET SHARED ACTIVITY HISTORY
// =====================================

router.get('/', async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: parsed.error.flatten()
      });
    }

    const {
      page,
      limit,
      entity,
      action
    } = parsed.data;

    const where = {
      messId: req.user.messId
    };

    if (entity) {
      where.entity = entity.toUpperCase();
    }

    if (action) {
      where.action = action.toUpperCase();
    }

    const [logs, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' }
        ],
        skip: (page - 1) * limit,
        take: limit
      }),

      prisma.auditLog.count({
        where
      })
    ]);

    // Fetch actor information without exposing sensitive data.
    const userIds = [
      ...new Set(logs.map(log => log.userId))
    ];

    const users = userIds.length
      ? await prisma.user.findMany({
          where: {
            id: {
              in: userIds
            },
            messId: req.user.messId
          },
          select: {
            id: true,
            name: true,
            role: true
          }
        })
      : [];

    const userMap = new Map(
      users.map(user => [user.id, user])
    );

    const activities = logs.map(log => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      metadata: log.metadata,
      createdAt: log.createdAt,

      actor: userMap.get(log.userId) || {
        id: log.userId,
        name: 'Former user',
        role: 'UNKNOWN'
      },

      isMine: log.userId === req.user.sub
    }));

    res.json({
      activities,

      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// =====================================
// UNDO MEAL ACTIVITY
// POST /api/activity/:logId/undo
// =====================================

router.post('/:logId/undo', async (req, res, next) => {
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Find original activity in this mess.
        const original = await tx.auditLog.findFirst({
          where: {
            id: req.params.logId,
            messId: req.user.messId,
            entity: 'MEAL'
          }
        });

        if (!original) {
          throw httpError('Activity not found.', 404);
        }

        // Only the original actor can undo.
        if (original.userId !== req.user.sub) {
          throw httpError(
            'You can only undo your own meal changes.',
            403
          );
        }

        const allowedActions = [
          'CREATE',
          'UPDATE',
          'DELETE',
          'RESTORE'
        ];

        if (!allowedActions.includes(original.action)) {
          throw conflict(
            'This activity cannot be undone.'
          );
        }

        const metadata = original.metadata;

        if (
          !hasSnapshot(metadata, 'before') ||
          !hasSnapshot(metadata, 'after')
        ) {
          throw conflict(
            'This activity does not contain enough information to undo.'
          );
        }

        const before = getSnapshot(metadata, 'before');
        const after = getSnapshot(metadata, 'after');

        // Find previous undo/redo operations for this meal.
        const relatedLogs = await tx.auditLog.findMany({
          where: {
            messId: req.user.messId,
            entity: 'MEAL',
            entityId: original.entityId,
            action: {
              in: ['UNDO', 'REDO']
            }
          },
          orderBy: [
            { createdAt: 'asc' },
            { id: 'asc' }
          ]
        });

        const undoLogs = relatedLogs.filter(
          log =>
            log.action === 'UNDO' &&
            log.metadata?.undoOfAuditLogId === original.id
        );

        const latestUndo = undoLogs.at(-1);

        if (latestUndo) {
          const alreadyRedone = relatedLogs.some(
            log =>
              log.action === 'REDO' &&
              log.metadata?.undoLogId === latestUndo.id
          );

          if (!alreadyRedone) {
            throw conflict(
              'This activity has already been undone.'
            );
          }
        }

        // Apply inverse of original operation.
        const expectedVersion =
          metadata.afterVersion ??
          after?.version ??
          null;

        const newState = await applyTransition(
          tx,
          req.user.messId,
          after,
          expectedVersion,
          before
        );

        // Append a new activity. Never delete old history.
        const undoLog = await writeAudit(
          tx,
          req,
          'UNDO',
          original.entityId,
          {
            undoOfAuditLogId: original.id,
            before: after,
            after: newState,
            beforeVersion: expectedVersion,
            afterVersion: newState?.version ?? null
          }
        );

        return {
          message: 'Meal activity undone successfully.',
          undoLogId: undoLog.id,
          meal: newState
        };
      },
      {
        isolationLevel: 'Serializable'
      }
    );

    res.json(result);
  } catch (error) {
    if (error.code === 'P2034') {
      return res.status(409).json({
        error: 'Concurrent activity detected. Refresh and retry.'
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'A conflicting meal already exists.'
      });
    }

    if (error.status) {
      return res.status(error.status).json({
        error: error.message
      });
    }

    next(error);
  }
});

// =====================================
// REDO UNDO OPERATION
// POST /api/activity/:logId/redo
//
// logId = UNDO activity ID
// =====================================

router.post('/:logId/redo', async (req, res, next) => {
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Find the undo operation.
        const undoLog = await tx.auditLog.findFirst({
          where: {
            id: req.params.logId,
            messId: req.user.messId,
            entity: 'MEAL',
            action: 'UNDO'
          }
        });

        if (!undoLog) {
          throw httpError(
            'Undo activity not found.',
            404
          );
        }

        // Only the user who performed Undo can Redo it.
        if (undoLog.userId !== req.user.sub) {
          throw httpError(
            'You can only redo your own undo operation.',
            403
          );
        }

        const metadata = undoLog.metadata || {};
        const originalId = metadata.undoOfAuditLogId;

        if (!originalId) {
          throw conflict(
            'Undo history is incomplete.'
          );
        }

        // Verify original activity ownership.
        const original = await tx.auditLog.findFirst({
          where: {
            id: originalId,
            messId: req.user.messId,
            entity: 'MEAL'
          }
        });

        if (!original || original.userId !== req.user.sub) {
          throw conflict(
            'Original activity is unavailable.'
          );
        }

        if (
          !hasSnapshot(metadata, 'before') ||
          !hasSnapshot(metadata, 'after')
        ) {
          throw conflict(
            'Undo history does not contain enough information to redo.'
          );
        }

        // Check whether this exact Undo was already redone.
        const existingRedo = await tx.auditLog.findFirst({
          where: {
            messId: req.user.messId,
            entity: 'MEAL',
            entityId: undoLog.entityId,
            action: 'REDO',
            metadata: {
              path: ['undoLogId'],
              equals: undoLog.id
            }
          }
        });

        if (existingRedo) {
          throw conflict(
            'This undo operation has already been redone.'
          );
        }

        // A later undo means this is no longer the latest operation.
        const laterUndo = await tx.auditLog.findFirst({
          where: {
            messId: req.user.messId,
            entity: 'MEAL',
            entityId: undoLog.entityId,
            action: 'UNDO',
            createdAt: {
              gt: undoLog.createdAt
            }
          }
        });

        if (laterUndo) {
          throw conflict(
            'A newer undo operation exists. Redo the latest operation first.'
          );
        }

        // After Undo:
        // metadata.after = current restored state
        // metadata.before = state to reapply
        const expected = getSnapshot(metadata, 'after');
        const target = getSnapshot(metadata, 'before');

        const expectedVersion =
          metadata.afterVersion ??
          expected?.version ??
          null;

        const newState = await applyTransition(
          tx,
          req.user.messId,
          expected,
          expectedVersion,
          target
        );

        // Append a new REDO log.
        const redoLog = await writeAudit(
          tx,
          req,
          'REDO',
          undoLog.entityId,
          {
            undoLogId: undoLog.id,
            redoOfAuditLogId: original.id,
            before: expected,
            after: newState,
            beforeVersion: expectedVersion,
            afterVersion: newState?.version ?? null
          }
        );

        return {
          message: 'Meal activity redone successfully.',
          redoLogId: redoLog.id,
          meal: newState
        };
      },
      {
        isolationLevel: 'Serializable'
      }
    );

    res.json(result);
  } catch (error) {
    if (error.code === 'P2034') {
      return res.status(409).json({
        error: 'Concurrent activity detected. Refresh and retry.'
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'A conflicting meal already exists.'
      });
    }

    if (error.status) {
      return res.status(error.status).json({
        error: error.message
      });
    }

    next(error);
  }
});

export default router;
