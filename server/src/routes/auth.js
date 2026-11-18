
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

// LOGIN
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
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mess: user.mess.name,
        memberId: user.member?.id || null
      }
    });
  } catch (error) {
    console.error('LOGIN ERROR:', error);

    return res.status(500).json({
      error: 'Unable to login. Please try again.'
    });
  }
});

// REGISTER
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

    const mess = await prisma.mess.findUnique({
      where: { joinCode }
    });

    if (!mess) {
      return res.status(400).json({
        error: 'Invalid mess invite code'
      });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({
        error: 'Email already registered'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async tx => {
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
        }
      });
    });

    const token = createToken(user);

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mess: mess.name,
        memberId: user.member?.id || null
      }
    });
  } catch (error) {
    console.error('REGISTER ERROR:', error);

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

// CURRENT USER
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
            name: true
          }
        },
        member: {
          select: {
            id: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    return res.json({
      user: {
        ...user,
        memberId: user.member?.id || null
      }
    });
  } catch (error) {
    console.error('AUTH ME ERROR:', error);

    return res.status(500).json({
      error: 'Unable to load user information'
    });
  }
});

export default r;
