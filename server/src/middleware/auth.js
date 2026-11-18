
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';

// =====================================
// AUTHENTICATION MIDDLEWARE
// Verify JWT and fetch current DB user
// =====================================

export async function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not configured');

    return res.status(500).json({
      error: 'Server authentication configuration error'
    });
  }

  let decoded;

  // Verify JWT token
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || typeof decoded.sub !== 'string') {
      return res.status(401).json({
        error: 'Invalid authentication token'
      });
    }

  } catch (error) {
    return res.status(401).json({
      error: 'Invalid or expired token'
    });
  }

  try {
    // Fetch current user from database.
    // Never trust role or messId stored in JWT.

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.sub
      },
      select: {
        id: true,
        name: true,
        email: true,
        messId: true,
        role: true,
        active: true
      }
    });

    if (!user) {
      return res.status(401).json({
        error: 'User account not found'
      });
    }

    // Block deactivated users
    if (!user.active) {
      return res.status(403).json({
        error: 'Your account has been deactivated'
      });
    }

    // Attach fresh database information
    req.user = {
      sub: user.id,
      name: user.name,
      email: user.email,
      messId: user.messId,
      role: user.role
    };

    return next();

  } catch (error) {
    console.error('AUTH MIDDLEWARE ERROR:', error);

    return res.status(500).json({
      error: 'Authentication verification failed'
    });
  }
}

// =====================================
// ROLE AUTHORIZATION MIDDLEWARE
// =====================================

export const roles = (...allowed) => {
  return (req, res, next) => {

    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required'
      });
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Permission denied'
      });
    }

    return next();
  };
};
