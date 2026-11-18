
import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../db.js';
import { roles } from '../middleware/auth.js';

const r = Router();

// Authentication is already applied globally in index.js.

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

// =====================================
// HELPERS
// =====================================

function getMessId(req, res) {
  if (!req.user?.messId || !req.user?.sub) {
    res.status(401).json({
      error: 'Invalid session. Please login again.'
    });

    return null;
  }

  return req.user.messId;
}

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

// =====================================
// GET ALL MEMBERS
// GET /api/members
// =====================================

r.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    const messId = getMessId(req, res);
    if (!messId) return;

    const members = await prisma.member.findMany({
      where: {
        messId
      },
      include: memberInclude,
      orderBy: {
        name: 'asc'
      }
    });

    return res.status(200).json(members);
  } catch (error) {
    return sendServerError(
      res,
      error,
      'Failed to load members'
    );
  }
});

// =====================================
// ADD MEMBER
// POST /api/members
// ADMIN / MANAGER ONLY
// =====================================

r.post(
  '/',
  roles('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const messId = getMessId(req, res);
      if (!messId) return;

      const parsed = memberSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid member information',
          details: parsed.error.flatten()
        });
      }

      const member = await prisma.member.create({
        data: {
          name: parsed.data.name,
          phone: parsed.data.phone ?? null,
          messId
        },
        include: memberInclude
      });

      return res.status(201).json(member);
    } catch (error) {
      return sendServerError(
        res,
        error,
        'Failed to create member'
      );
    }
  }
);

// =====================================
// UPDATE MEMBER
// PATCH /api/members/:id
// ADMIN / MANAGER ONLY
// =====================================

r.patch(
  '/:id',
  roles('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const messId = getMessId(req, res);
      if (!messId) return;

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
          messId
        },
        select: {
          id: true
        }
      });

      if (!existing) {
        return res.status(404).json({
          error: 'Member not found'
        });
      }

      const updated = await prisma.member.updateMany({
        where: {
          id: existing.id,
          messId
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
          messId
        },
        include: memberInclude
      });

      return res.json(member);
    } catch (error) {
      return sendServerError(
        res,
        error,
        'Failed to update member'
      );
    }
  }
);

// =====================================
// DEACTIVATE MEMBER
// PATCH /api/members/:id/deactivate
// ADMIN ONLY
// =====================================

r.patch(
  '/:id/deactivate',
  roles('ADMIN'),
  async (req, res) => {
    try {
      const messId = getMessId(req, res);
      if (!messId) return;

      const result = await prisma.member.updateMany({
        where: {
          id: req.params.id,
          messId,
          active: true
        },
        data: {
          active: false
        }
      });

      if (result.count !== 1) {
        const member = await prisma.member.findFirst({
          where: {
            id: req.params.id,
            messId
          }
        });

        if (!member) {
          return res.status(404).json({
            error: 'Member not found'
          });
        }

        return res.status(409).json({
          error: 'Member is already inactive'
        });
      }

      return res.json({
        ok: true,
        message: 'Member deactivated successfully'
      });
    } catch (error) {
      return sendServerError(
        res,
        error,
        'Failed to deactivate member'
      );
    }
  }
);

// =====================================
// REACTIVATE MEMBER
// PATCH /api/members/:id/activate
// ADMIN ONLY
// =====================================

r.patch(
  '/:id/activate',
  roles('ADMIN'),
  async (req, res) => {
    try {
      const messId = getMessId(req, res);
      if (!messId) return;

      const result = await prisma.member.updateMany({
        where: {
          id: req.params.id,
          messId,
          active: false
        },
        data: {
          active: true
        }
      });

      if (result.count !== 1) {
        const member = await prisma.member.findFirst({
          where: {
            id: req.params.id,
            messId
          }
        });

        if (!member) {
          return res.status(404).json({
            error: 'Member not found'
          });
        }

        return res.status(409).json({
          error: 'Member is already active'
        });
      }

      return res.json({
        ok: true,
        message: 'Member activated successfully'
      });
    } catch (error) {
      return sendServerError(
        res,
        error,
        'Failed to activate member'
      );
    }
  }
);

export default r;
