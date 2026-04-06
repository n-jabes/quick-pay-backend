import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export type AuditStatus = 'SUCCESS' | 'FAILURE';

export async function writeAudit(params: {
  userId?: string | null;
  action: string;
  resource?: string | null;
  status: AuditStatus;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? undefined,
        action: params.action,
        resource: params.resource ?? undefined,
        status: params.status,
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
        metadata:
          params.metadata === undefined
            ? undefined
            : (params.metadata as Prisma.InputJsonValue),
      },
    });
  } catch {
    // Never break primary flow on audit failure
  }
}
