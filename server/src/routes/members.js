
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../db.js';

const r = Router();

// =====================================
// VALIDATION
// =====================================

const memberSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30).nullable().optional()
});

const updateMemberSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().max(30).nullable().optional()
}).strict().refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field is required' }
);

const capacitySchema = z.object({
  maxMembers: z.coerce.number().int().min(1).max(500)
});

// =====================================
// HELPERS
// =====================================

const memberInclude = {
  user: {
    select: {
      id: true,
      email: true,
      role: true,
      active: true
    }
  }
};

async function getCurrentUser(req) {
  if (!req.user?.sub || !req.user?.messId) {
    return null;
  }

  return prisma.user.findFirst({
    where: {
      id: req.user.sub,
      messId: req.user.messId,
      active: true
    },
    select: {
      id: true,
      messId: true,
      role: true,
      name: true
    }
  });
}

function sendServerError(res, error, message) {
  console.error(message, error);

  if (error?.code === 'P2034') {
    return res.status(409).json({
      error: 'Another operation changed the workspace. Please try again.'
    });
  }

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

async function requireRole(req, res, allowedRoles) {
  const user = await getCurrentUser(req);

  if (!user) {
    res.status(401).json({
      error: 'Invalid session. Please login again.'
    });
    return null;
  }

  if (!allowedRoles.includes(user.role)) {
    res.status(403).json({
      error: 'Permission denied'
    });
    return null;
  }

  return user;
}

// =====================================
// GET ALL MEMBERS
// GET /api/members
// =====================================

r.get('/', async (req, res) => {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'Invalid session. Please login again.'
      });
    }

    res.set('Cache-Control', 'no-store');

    const members = await prisma.member.findMany({
      where: {
        messId: user.messId
      },
      include: memberInclude,
      orderBy: {
        name: 'asc'
      }
    });

    return res.json(members);
  } catch (error) {
    return sendServerError(res, error, 'Failed to load members');
  }
});

// =====================================
// GET WORKSPACE CAPACITY
// GET /api/members/capacity
// =====================================

r.get('/capacity', async (req, res) => {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'Invalid session. Please login again.'
      });
    }

    const mess = await prisma.mess.findUnique({
      where: { id: user.messId },
      select: {
        id: true,
        name: true,
        maxMembers: true
      }
    });

    if (!mess) {
      return res.status(404).json({
        error: 'Mess not found'
      });
    }

    const activeMembers = await prisma.member.count({
      where: {
        messId: user.messId,
        active: true
      }
    });

    return res.json({
      ...mess,
      activeMembers,
      availableSlots: Math.max(
        0,
        mess.maxMembers - activeMembers
      )
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to load capacity');
  }
});

// =====================================
// UPDATE MEMBER CAPACITY
// PATCH /api/members/capacity
// ADMIN ONLY
// =====================================

r.patch('/capacity', async (req, res) => {
  try {
    const user = await requireRole(req, res, ['ADMIN']);
    if (!user) return;

    const parsed = capacitySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid capacity',
        details: parsed.error.flatten()
      });
    }

    const { maxMembers } = parsed.data;

    const result = await prisma.$transaction(async tx => {
      const activeMembers = await tx.member.count({
        where: {
          messId: user.messId,
          active: true
        }
      });

      if (maxMembers < activeMembers) {
        const error = new Error(
          `Capacity cannot be lower than ${activeMembers} active members`
        );
        error.statusCode = 409;
        throw error;
      }

      const mess = await tx.mess.update({
        where: { id: user.messId },
        data: { maxMembers },
        select: {
          id: true,
          name: true,
          maxMembers: true
        }
      });

      return {
        ...mess,
        activeMembers,
        availableSlots: maxMembers - activeMembers
      };
    }, {
      isolationLevel: 'Serializable'
    });

    return res.json({
      message: 'Member capacity updated successfully',
      workspace: result
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message
      });
    }

    return sendServerError(res, error, 'Failed to update capacity');
  }
});

// =====================================
// ADD MEMBER
// POST /api/members
// ADMIN / MANAGER ONLY
// =====================================

r.post('/', async (req, res) => {
  try {
    const user = await requireRole(req, res, ['ADMIN', 'MANAGER']);
    if (!user) return;

    const parsed = memberSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid member information',
        details: parsed.error.flatten()
      });
    }

    const member = await prisma.$transaction(async tx => {
      const mess = await tx.mess.findUnique({
        where: { id: user.messId },
        select: { maxMembers: true }
      });

      if (!mess) {
        const error = new Error('Mess not found');
        error.statusCode = 404;
        throw error;
      }

      const activeMembers = await tx.member.count({
        where: {
          messId: user.messId,
          active: true
        }
      });

      if (activeMembers >= mess.maxMembers) {
        const error = new Error(
          'Mess is full. Admin must increase capacity first.'
        );
        error.statusCode = 409;
        throw error;
      }

      return tx.member.create({
        data: {
          name: parsed.data.name,
          phone: parsed.data.phone ?? null,
          messId: user.messId
        },
        include: memberInclude
      });
    }, {
      isolationLevel: 'Serializable'
    });

    return res.status(201).json(member);
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message
      });
    }

    return sendServerError(res, error, 'Failed to create member');
  }
});

// =====================================
// UPDATE MEMBER
// PATCH /api/members/:id
// ADMIN / MANAGER ONLY
// =====================================

r.patch('/:id', async (req, res) => {
  try {
    const user = await requireRole(req, res, ['ADMIN', 'MANAGER']);
    if (!user) return;

    const parsed = updateMemberSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid member update',
        details: parsed.error.flatten()
      });
    }

    const existing = await prisma.member.findFirst({
      where: {
        id: req.params.id,
        messId: user.messId
      },
      select: { id: true }
    });

    if (!existing) {
      return res.status(404).json({
        error: 'Member not found'
      });
    }

    const updated = await prisma.member.updateMany({
      where: {
        id: existing.id,
        messId: user.messId
      },
      data: parsed.data
    });

    if (updated.count !== 1) {
      return res.status(409).json({
        error: 'Member was changed. Please refresh and try again.'
      });
    }

    const member = await prisma.member.findFirst({
      where: {
        id: existing.id,
        messId: user.messId
      },
      include: memberInclude
    });

    return res.json(member);
  } catch (error) {
    return sendServerError(res, error, 'Failed to update member');
  }
});

// =====================================
// DEACTIVATE MEMBER
// PATCH /api/members/:id/deactivate
// ADMIN ONLY
// =====================================

r.patch('/:id/deactivate', async (req, res) => {
  try {
    const user = await requireRole(req, res, ['ADMIN']);
    if (!user) return;

    const member = await prisma.member.findFirst({
      where: {
        id: req.params.id,
        messId: user.messId
      },
      include: {
        user: true
      }
    });

    if (!member) {
      return res.status(404).json({
        error: 'Member not found'
      });
    }

    if (member.userId === user.id) {
      return res.status(400).json({
        error: 'Admin cannot deactivate their own membership'
      });
    }

    await prisma.$transaction(async tx => {
      await tx.member.update({
        where: { id: member.id },
        data: { active: false }
      });

      if (member.userId) {
        await tx.user.update({
          where: { id: member.userId },
          data: { active: false }
        });
      }
    });

    return res.json({
      ok: true,
      message: 'Member deactivated successfully'
    });
  } catch (error) {
    return sendServerError(res, error, 'Failed to deactivate member');
  }
});

// =====================================
// REACTIVATE MEMBER
// PATCH /api/members/:id/activate
// ADMIN ONLY
// =====================================

r.patch('/:id/activate', async (req, res) => {
  try {
    const user = await requireRole(req, res, ['ADMIN']);
    if (!user) return;

    const result = await prisma.$transaction(async tx => {
      const member = await tx.member.findFirst({
        where: {
          id: req.params.id,
          messId: user.messId
        },
        include: {
          user: true
        }
      });

      if (!member) {
        const error = new Error('Member not found');
        error.statusCode = 404;
        throw error;
      }

      if (member.active) {
        const error = new Error('Member is already active');
        error.statusCode = 409;
        throw error;
      }

      const mess = await tx.mess.findUnique({
        where: { id: user.messId },
        select: { maxMembers: true }
      });

      const activeMembers = await tx.member.count({
        where: {
          messId: user.messId,
          active: true
        }
      });

      if (activeMembers >= mess.maxMembers) {
        const error = new Error(
          'Mess is full. Increase capacity before reactivating this member.'
        );
        error.statusCode = 409;
        throw error;
      }

      await tx.member.update({
        where: { id: member.id },
        data: { active: true }
      });

      if (member.userId) {
        await tx.user.update({
          where: { id: member.userId },
          data: { active: true }
        });
      }

      return true;
    }, {
      isolationLevel: 'Serializable'
    });

    return res.json({
      ok: result,
      message: 'Member activated successfully'
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message
      });
    }

    return sendServerError(res, error, 'Failed to activate member');
  }
});

// =====================================
// TRANSFER ADMIN
// POST /api/members/:id/transfer-admin
// ADMIN ONLY
// =====================================

r.post('/:id/transfer-admin', async (req, res) => {
  try {
    const currentAdmin = await requireRole(req, res, ['ADMIN']);
    if (!currentAdmin) return;

    const result = await prisma.$transaction(async tx => {
      const targetMember = await tx.member.findFirst({
        where: {
          id: req.params.id,
          messId: currentAdmin.messId,
          active: true,
          userId: { not: null }
        },
        include: {
          user: true
        }
      });

      if (!targetMember?.user || !targetMember.user.active) {
        const error = new Error(
          'Select an active member who has a registered account'
        );
        error.statusCode = 400;
        throw error;
      }

      if (targetMember.user.id === currentAdmin.id) {
        const error = new Error('You are already the admin');
        error.statusCode = 400;
        throw error;
      }

      await tx.user.update({
        where: { id: currentAdmin.id },
        data: { role: 'MEMBER' }
      });

      const newAdmin = await tx.user.update({
        where: { id: targetMember.user.id },
        data: { role: 'ADMIN' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true
        }
      });

      return newAdmin;
    }, {
      isolationLevel: 'Serializable'
    });

    return res.json({
      ok: true,
      message: 'Admin role transferred successfully. Please login again.',
      newAdmin: result
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message
      });
    }

    return sendServerError(res, error, 'Failed to transfer admin role');
  }
});

export default r;
