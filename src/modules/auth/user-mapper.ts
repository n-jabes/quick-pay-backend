import type { Prisma } from '@prisma/client';
import { decryptField } from '../../lib/field-encryption';

export type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

export function roleToClient(code: UserWithRole['role']['code']): string {
  const map: Record<UserWithRole['role']['code'], string> = {
    ADMIN: 'admin',
    SUPERVISOR: 'supervisor',
    AGENT: 'agent',
  };
  return map[code];
}

export function toAuthUserResponse(user: UserWithRole) {
  const nationalId = decryptField(user.nationalIdEnc) ?? '';
  return {
    uuid: user.publicId,
    fullName: user.fullName,
    username: user.username,
    phone: user.phone ?? '',
    email: user.email,
    IDNumber: nationalId,
    gender: user.gender ?? '',
    role: roleToClient(user.role.code),
    ...(user.agentCode ? { agentCode: user.agentCode } : {}),
    ...(user.outletName ? { outletName: user.outletName } : {}),
    ...(user.outletCode ? { outletCode: user.outletCode } : {}),
    status: user.status,
    language: user.language,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
