
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { prisma } from '../db.js';
import { auth } from '../middleware/auth.js';

const r = Router();

const loginSchema = z.object({
  email: z.string().email().transform(v => v.trim().toLowerCase()),
  password: z.string().min(8)
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email().transform(v => v.trim().toLowerCase()),
  password: z.string().min(8),
  joinCode: z.string().trim().min(4)
});

const createMessSchema = z.object({
  name: z.string().trim().min(2).max(80),
  messName: z.string().trim().min(2).max(80),
  email: z.string().email().transform(v => v.trim().toLowerCase()),
  password: z.string().min(8)
});

function createToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.sign(
    {
      sub: user.id,
      messId: user.messId,
      role: user.role,
      name: user.name
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    }
  );
}

function userResponse(user, messName) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mess: messName,
    memberId: user.member?.id || null
  };
}

// Retry serializable transactions if concurrent requests conflict.
async function serializableTransaction(callback) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: 'Serializable'
      });
    } catch (error) {
      if (error.code !== 'P2034' || attempt === 3) {
        throw error;
      }
    }
  }
}

// =====================================
// LOGIN
// =====================================

r.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid input',
        details: parsed.error.flatten()
      });
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        mess: true,
        member: true
      }
    });

    if (
      !user ||
      !user.active ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      return res.status(401).json({
        error: 'Email or password incorrect'
      });
    }

    const token = createToken(user);

    return res.json({
      token,
      user: userResponse(user, user.mess.name),
      workspace: {
        id: user.mess.id,
        name: user.mess.name,
        maxMembers: user.mess.maxMembers
      }
    });
  } catch (error) {
    console.error('LOGIN ERROR:', error);

    return res.status(500).json({
      error: 'Unable to login. Please try again.'
    });
  }
});

// =====================================
// CREATE NEW MESS
// First user becomes ADMIN
// =====================================

r.post('/create-mess', async (req, res) => {
  try {
    const parsed = createMessSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid registration details',
        details: parsed.error.flatten()
      });
    }

    const { name, messName, email, password } = parsed.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'Email already registered'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await serializableTransaction(async tx => {
      const mess = await tx.mess.create({
        data: {
          name: messName,
          maxMembers: 6,
          settings: {
            create: {
              currency: 'BDT',
              mealRate: 0,
              allowMemberMealEdit: true
            }
          }
        }
      });

      const member = await tx.member.create({
        data: {
          messId: mess.id,
          name
        }
      });

      return tx.user.create({
        data: {
          messId: mess.id,
          name,
          email,
          passwordHash,
          role: 'ADMIN',
          member: {
            connect: { id: member.id }
          }
        },
        include: {
          member: true
        }
      });
    });

    const token = createToken(user);

    const mess = await prisma.mess.findUnique({
      where: { id: user.messId },
      select: {
        id: true,
        name: true,
        maxMembers: true
      }
    });

    return res.status(201).json({
      message: 'Mess created successfully',
      token,
      user: userResponse(user, mess.name),
      workspace: mess
    });
  } catch (error) {
    console.error('CREATE MESS ERROR:', error);

    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Email already registered or duplicate data'
      });
    }

    return res.status(500).json({
      error: 'Unable to create mess. Please try again.'
    });
  }
});

// =====================================
// JOIN EXISTING MESS
// =====================================

r.post('/register', async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid registration details',
        details: parsed.error.flatten()
      });
    }

    const { name, email, password, joinCode } = parsed.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'Email already registered'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await serializableTransaction(async tx => {
      const mess = await tx.mess.findUnique({
        where: { joinCode }
      });

      if (!mess) {
        const error = new Error('Invalid mess invite code');
        error.statusCode = 400;
        throw error;
      }

      const activeMembers = await tx.member.count({
        where: {
          messId: mess.id,
          active: true
        }
      });

      if (activeMembers >= mess.maxMembers) {
        const error = new Error('This mess has reached its member capacity');
        error.statusCode = 409;
        throw error;
      }

      const member = await tx.member.create({
        data: {
          messId: mess.id,
          name
        }
      });

      return tx.user.create({
        data: {
          messId: mess.id,
          name,
          email,
          passwordHash,
          role: 'MEMBER',
          member: {
            connect: { id: member.id }
          }
        },
        include: {
          member: true
        }
      });
    });

    const mess = await prisma.mess.findUnique({
      where: { id: user.messId },
      select: {
        id: true,
        name: true,
        maxMembers: true
      }
    });

    const token = createToken(user);

    return res.status(201).json({
      message: 'Joined mess successfully',
      token,
      user: userResponse(user, mess.name),
      workspace: mess
    });
  } catch (error) {
    console.error('REGISTER ERROR:', error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message
      });
    }

    if (error.code === 'P2002') {
      return res.status(409).json({
        error: 'Email already registered'
      });
    }

    return res.status(500).json({
      error: 'Unable to register. Please try again.'
    });
  }
});

// =====================================
// ADMIN INVITE INFORMATION
// =====================================

r.get('/invite', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        role: true,
        messId: true
      }
    });

    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Only the mess admin can view invite information'
      });
    }

    const mess = await prisma.mess.findUnique({
      where: { id: user.messId },
      select: {
        id: true,
        name: true,
        joinCode: true,
        maxMembers: true,
        members: {
          where: { active: true },
          select: { id: true }
        }
      }
    });

    if (!mess) {
      return res.status(404).json({
        error: 'Mess not found'
      });
    }

    return res.json({
      messId: mess.id,
      messName: mess.name,
      inviteCode: mess.joinCode,
      maxMembers: mess.maxMembers,
      activeMembers: mess.members.length,
      availableSlots: Math.max(
        0,
        mess.maxMembers - mess.members.length
      )
    });
  } catch (error) {
    console.error('INVITE ERROR:', error);

    return res.status(500).json({
      error: 'Unable to load invite information'
    });
  }
});

// =====================================
// CURRENT USER
// =====================================

r.get('/me', auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.user.sub
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mess: {
          select: {
            id: true,
            name: true,
            maxMembers: true
          }
        },
        member: {
          select: {
            id: true
          }
        }
      }
    });

    if (!user || !user.mess) {
      return res.status(404).json({
        error: 'User or workspace not found'
      });
    }

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mess: user.mess.name,
        memberId: user.member?.id || null
      },
      workspace: user.mess
    });
  } catch (error) {
    console.error('AUTH ME ERROR:', error);

    return res.status(500).json({
      error: 'Unable to load user information'
    });
  }
});

export default r;
