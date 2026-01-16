/** @format */

import { prisma } from './prisma';

export async function checkFilePermission(userId, fileId, permission) {
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    include: {
      owner: true,
      permissions: {
        where: { userId },
      },
    },
  });

  if (!file) {
    return { allowed: false, error: 'File not found' };
  }

  // Owner has all permissions
  if (file.ownerId === userId) {
    return { allowed: true, file };
  }

  const userPermission = file.permissions[0];

  if (!userPermission) {
    return { allowed: false, error: 'Access denied' };
  }

  const permissionMap = {
    read: userPermission.canRead,
    write: userPermission.canWrite,
    delete: userPermission.canDelete,
    share: userPermission.canShare,
  };

  if (!permissionMap[permission]) {
    return { allowed: false, error: 'Insufficient permissions' };
  }

  return { allowed: true, file };
}

export async function checkUserIsAdmin(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  return user && user.role === 'admin';
}
