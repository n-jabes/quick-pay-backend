import type { NextFunction, Request, Response } from 'express';
import createError from 'http-errors';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../lib/tokens';
import { roleToClient } from '../modules/auth/user-mapper';

export interface AuthUser {
  id: string;
  publicId: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!bearer) {
      next(createError(401, 'Unauthorized'));
      return;
    }
    const payload = verifyAccessToken(bearer);
    const user = await prisma.user.findUnique({
      where: { publicId: payload.sub },
      include: { role: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      next(createError(401, 'Unauthorized'));
      return;
    }
    req.authUser = {
      id: user.id,
      publicId: user.publicId,
      role: roleToClient(user.role.code),
    };
    next();
  } catch {
    next(createError(401, 'Unauthorized'));
  }
}
