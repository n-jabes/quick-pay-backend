import { RoleCode, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import createError from 'http-errors';
import type { Request, Response } from 'express';
import { randomBytes, randomInt } from 'crypto';
import { getEnv } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { encryptField } from '../../lib/field-encryption';
import { sendCredentialsViaEmail } from '../../integrations/email/resend-email.service';
import { writeAudit } from '../audit/audit.service';
import { roleToClient, toAuthUserResponse } from '../auth/user-mapper';

type ClientRole = 'admin' | 'supervisor' | 'agent';

function getClientMeta(req: Request) {
  const ip = (typeof req.ip === 'string' && req.ip) || req.socket.remoteAddress || null;
  const userAgent = req.get('user-agent') ?? null;
  return { ip, userAgent };
}

function clientRoleToDb(role: ClientRole): RoleCode {
  if (role === 'admin') return 'ADMIN';
  if (role === 'supervisor') return 'SUPERVISOR';
  return 'AGENT';
}

function canManageTarget(params: {
  actorRole: ClientRole;
  actorId: string;
  targetId: string;
  targetRole: RoleCode;
}): boolean {
  const { actorRole, actorId, targetId, targetRole } = params;
  if (actorRole === 'admin') return true;
  if (actorRole !== 'supervisor') return false;
  if (targetId === actorId) return true;
  return targetRole === 'AGENT';
}

async function generateUniqueUsername(email: string): Promise<string> {
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 18) || 'user';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = randomInt(1000, 9999);
    const candidate = `${base}${suffix}`;
    const exists = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `user${Date.now()}`;
}

function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const symbols = '!@#$%&*';
  const random = randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `${random}${alphabet[randomInt(0, alphabet.length)]}${symbols[randomInt(0, symbols.length)]}9`;
}

function encryptNationalIdRequired(nationalId: string): string {
  const encrypted = encryptField(nationalId);
  if (!encrypted) {
    throw createError(500, 'National ID encryption is not configured. Set ENCRYPTION_KEY_BASE64.');
  }
  return encrypted;
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const actor = req.authUser;
  if (!actor) {
    throw createError(401, 'Unauthorized');
  }
  if (actor.role !== 'admin' && actor.role !== 'supervisor') {
    throw createError(403, 'Forbidden');
  }

  const where =
    actor.role === 'admin'
      ? {}
      : {
          OR: [{ id: actor.id }, { role: { code: 'AGENT' as const } }],
        };

  const users = await prisma.user.findMany({
    where,
    include: { role: true },
    orderBy: [{ createdAt: 'desc' }],
  });

  res.status(200).json({ data: users.map((user) => toAuthUserResponse(user)) });
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const actor = req.authUser;
  if (!actor) throw createError(401, 'Unauthorized');
  if (actor.role !== 'admin' && actor.role !== 'supervisor') throw createError(403, 'Forbidden');

  const payload = req.body as {
    fullName: string;
    email: string;
    phone: string;
    nationalID: string;
    gender?: string;
    language?: string;
    role: ClientRole;
    agentCode?: string | null;
  };
  const { ip, userAgent } = getClientMeta(req);

  if (actor.role === 'supervisor' && payload.role !== 'agent') {
    throw createError(403, 'Supervisors can only create agents');
  }

  if (payload.role === 'agent' && !payload.agentCode?.trim()) {
    throw createError(400, 'Agent code is required for agent users');
  }

  const email = payload.email.toLowerCase();
  const username = await generateUniqueUsername(email);
  const temporaryPassword = generateTemporaryPassword();
  const env = getEnv();
  const passwordHash = await bcrypt.hash(temporaryPassword + env.PASSWORD_PEPPER, env.BCRYPT_ROUNDS);
  const nationalIdEnc = encryptNationalIdRequired(payload.nationalID);

  let created;
  try {
    created = await prisma.user.create({
      data: {
        fullName: payload.fullName,
        email,
        username,
        phone: payload.phone,
        passwordHash,
        nationalIdEnc,
        gender: payload.gender ?? null,
        language: payload.language ?? 'English',
        agentCode: payload.role === 'agent' ? payload.agentCode?.trim() ?? null : null,
        role: { connect: { code: clientRoleToDb(payload.role) } },
      },
      include: { role: true },
    });
  } catch {
    throw createError(400, 'Unable to create user');
  }

  await writeAudit({
    userId: actor.id,
    action: 'USER_CREATED',
    resource: 'user',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
    metadata: {
      actorPublicId: actor.publicId,
      targetPublicId: created.publicId,
      targetUsername: created.username,
      createdRole: roleToClient(created.role.code),
    },
  });

  const credentialsEmail = await sendCredentialsViaEmail({
    toEmail: created.email,
    fullName: created.fullName,
    username: created.username,
    temporaryPassword,
  });

  if (!credentialsEmail.ok) {
    await prisma.user.delete({ where: { id: created.id } }).catch(() => undefined);
    await writeAudit({
      userId: actor.id,
      action: 'USER_CREDENTIALS_EMAIL_SEND_FAILED',
      resource: 'user',
      status: 'FAILURE',
      ipAddress: ip,
      userAgent,
      metadata: {
        actorPublicId: actor.publicId,
        targetEmail: created.email,
        statusCode: credentialsEmail.status,
      },
    });
    throw createError(502, 'User creation email failed. Please verify email provider settings and retry.');
  }

  await writeAudit({
    userId: actor.id,
    action: 'USER_CREDENTIALS_EMAIL_SENT',
    resource: 'user',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
    metadata: {
      actorPublicId: actor.publicId,
      targetPublicId: created.publicId,
      targetEmail: created.email,
    },
  });

  res.status(201).json({
    data: toAuthUserResponse(created),
    message: 'User created and credentials email sent successfully',
  });
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const actor = req.authUser;
  if (!actor) {
    throw createError(401, 'Unauthorized');
  }
  if (actor.role !== 'admin' && actor.role !== 'supervisor') {
    throw createError(403, 'Forbidden');
  }

  const { publicId } = req.params as { publicId: string };
  const payload = req.body as {
    fullName?: string;
    email?: string;
    phone?: string;
    gender?: string;
    language?: string;
    role?: ClientRole;
    agentCode?: string | null;
    nationalID?: string;
  };
  const { ip, userAgent } = getClientMeta(req);

  const target = await prisma.user.findUnique({
    where: { publicId },
    include: { role: true },
  });

  if (!target) {
    throw createError(404, 'User not found');
  }

  if (!canManageTarget({ actorRole: actor.role as ClientRole, actorId: actor.id, targetId: target.id, targetRole: target.role.code })) {
    throw createError(403, 'Forbidden');
  }

  if (actor.role === 'supervisor' && payload.role && payload.role !== 'agent') {
    throw createError(403, 'Supervisors can only assign agent role');
  }

  const data: Record<string, unknown> = {};
  if (payload.fullName !== undefined) data.fullName = payload.fullName;
  if (payload.email !== undefined) data.email = payload.email.toLowerCase();
  if (payload.phone !== undefined) data.phone = payload.phone;
  if (payload.gender !== undefined) data.gender = payload.gender;
  if (payload.language !== undefined) data.language = payload.language;
  if (payload.agentCode !== undefined) data.agentCode = payload.agentCode;
  if (payload.nationalID !== undefined) {
    data.nationalIdEnc = encryptNationalIdRequired(payload.nationalID);
  }
  if (payload.role !== undefined) {
    data.role = { connect: { code: clientRoleToDb(payload.role) } };
  }

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: target.id },
      data,
      include: { role: true },
    });
  } catch {
    throw createError(400, 'Unable to update user');
  }

  await writeAudit({
    userId: actor.id,
    action: 'USER_UPDATED',
    resource: 'user',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
    metadata: {
      actorPublicId: actor.publicId,
      targetPublicId: target.publicId,
      targetUsername: target.username,
      changes: Object.keys(data),
    },
  });

  res.status(200).json({ data: toAuthUserResponse(updated) });
}

export async function updateUserStatus(req: Request, res: Response): Promise<void> {
  const actor = req.authUser;
  if (!actor) {
    throw createError(401, 'Unauthorized');
  }
  if (actor.role !== 'admin' && actor.role !== 'supervisor') {
    throw createError(403, 'Forbidden');
  }

  const { publicId } = req.params as { publicId: string };
  const { status } = req.body as { status: UserStatus };
  const { ip, userAgent } = getClientMeta(req);

  const target = await prisma.user.findUnique({
    where: { publicId },
    include: { role: true },
  });

  if (!target) {
    throw createError(404, 'User not found');
  }

  if (!canManageTarget({ actorRole: actor.role as ClientRole, actorId: actor.id, targetId: target.id, targetRole: target.role.code })) {
    throw createError(403, 'Forbidden');
  }

  if (target.id === actor.id && status === 'DEACTIVATED') {
    throw createError(400, 'You cannot deactivate your own account');
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { status },
    include: { role: true },
  });

  await writeAudit({
    userId: actor.id,
    action: status === 'DEACTIVATED' ? 'USER_DEACTIVATED' : 'USER_ACTIVATED',
    resource: 'user',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
    metadata: {
      actorPublicId: actor.publicId,
      targetPublicId: target.publicId,
      targetUsername: target.username,
      targetRole: roleToClient(target.role.code),
      nextStatus: status,
    },
  });

  res.status(200).json({ data: toAuthUserResponse(updated) });
}

export async function updateOwnProfile(req: Request, res: Response): Promise<void> {
  const actor = req.authUser;
  if (!actor) {
    throw createError(401, 'Unauthorized');
  }

  const payload = req.body as {
    fullName?: string;
    email?: string;
    phone?: string;
    gender?: string;
    language?: string;
    nationalID?: string;
  };
  const { ip, userAgent } = getClientMeta(req);

  const data: Record<string, unknown> = {};
  if (payload.fullName !== undefined) data.fullName = payload.fullName;
  if (payload.email !== undefined) {
    if (actor.role === 'agent') {
      throw createError(403, 'Agents are not allowed to change email');
    }
    data.email = payload.email.toLowerCase();
  }
  if (payload.phone !== undefined) data.phone = payload.phone;
  if (payload.gender !== undefined) data.gender = payload.gender;
  if (payload.language !== undefined) data.language = payload.language;
  if (payload.nationalID !== undefined) data.nationalIdEnc = encryptNationalIdRequired(payload.nationalID);

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: actor.id },
      data,
      include: { role: true },
    });
  } catch {
    throw createError(400, 'Unable to update profile');
  }

  await writeAudit({
    userId: actor.id,
    action: 'USER_PROFILE_UPDATED',
    resource: 'user',
    status: 'SUCCESS',
    ipAddress: ip,
    userAgent,
    metadata: {
      actorPublicId: actor.publicId,
      changes: Object.keys(data),
    },
  });

  res.status(200).json({ data: toAuthUserResponse(updated) });
}

