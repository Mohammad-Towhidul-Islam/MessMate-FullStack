
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { roles } from '../middleware/auth.js';

const r = Router();

const memberSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30).optional()
});

// Get all members of logged-in user's mess
r.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    if (!req.user?.messId) {
      return res.status(401).json({
        error: 'User is not connected to a mess'
      });
    }

    const members = await prisma.member.findMany({
      where: {
        messId: req.user.messId
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            active: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    console.log(
      `Loaded ${members.length} members for mess ${req.user.messId}`
    );

    return res.status(200).json(members);

  } catch (error) {
    console.error('Get members error:', error);

    return res.status(500).json({
      error: 'Failed to load members'
    });
  }
});

// Add new member
r.post('/', roles('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const parsed = memberSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid member information',
        details: parsed.error.flatten()
      });
    }

    const member = await prisma.member.create({
      data: {
        ...parsed.data,
        messId: req.user.messId
      }
    });

    return res.status(201).json(member);

  } catch (error) {
    console.error('Create member error:', error);

    return res.status(500).json({
      error: 'Failed to create member'
    });
  }
});

// Update member
r.patch('/:id', roles('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const parsed = memberSchema.partial().safeParse(req.body);

    if (
      !parsed.success ||
      Object.keys(parsed.data || {}).length === 0
    ) {
      return res.status(400).json({
        error: 'Invalid member update'
      });
    }

    const existing = await prisma.member.findFirst({
      where: {
        id: req.params.id,
        messId: req.user.messId
      }
    });

    if (!existing) {
      return res.status(404).json({
        error: 'Member not found'
      });
    }

    const updated = await prisma.member.update({
      where: {
        id: existing.id
      },
      data: parsed.data
    });

    return res.json(updated);

  } catch (error) {
    console.error('Update member error:', error);

    return res.status(500).json({
      error: 'Failed to update member'
    });
  }
});

// Deactivate member
r.patch('/:id/deactivate', roles('ADMIN'), async (req, res) => {
  try {
    const member = await prisma.member.findFirst({
      where: {
        id: req.params.id,
        messId: req.user.messId
      }
    });

    if (!member) {
      return res.status(404).json({
        error: 'Member not found'
      });
    }

    await prisma.member.update({
      where: {
        id: member.id
      },
      data: {
        active: false
      }
    });

    return res.json({
      ok: true,
      message: 'Member deactivated successfully'
    });

  } catch (error) {
    console.error('Deactivate member error:', error);

    return res.status(500).json({
      error: 'Failed to deactivate member'
    });
  }
});

// Reactivate member
r.patch('/:id/activate', roles('ADMIN'), async (req, res) => {
  try {
    const member = await prisma.member.findFirst({
      where: {
        id: req.params.id,
        messId: req.user.messId
      }
    });

    if (!member) {
      return res.status(404).json({
        error: 'Member not found'
      });
    }

    await prisma.member.update({
      where: {
        id: member.id
      },
      data: {
        active: true
      }
    });

    return res.json({
      ok: true,
      message: 'Member activated successfully'
    });

  } catch (error) {
    console.error('Activate member error:', error);

    return res.status(500).json({
      error: 'Failed to activate member'
    });
  }
});

export default r;
