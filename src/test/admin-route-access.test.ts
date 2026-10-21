import { describe, it, expect, vi, beforeEach } from 'vitest';
const { status } = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('@/lib/portal-access.functions', () => ({ getAdminStatus: status }));
import { requireWorkspaceAccess } from '@/lib/admin-route-access';

describe('Workspace sign-in access', () => {
  beforeEach(() => status.mockReset());
  it('redirects signed-out visitors to the standalone login page', async () => {
    status.mockResolvedValue({ unlocked: false, name: '' });
    await expect(requireWorkspaceAccess()).rejects.toMatchObject({ options: { to: '/login', replace: true } });
  });
  it('allows a verified Admin to enter the workspace', async () => {
    status.mockResolvedValue({ unlocked: true, name: 'Admin' });
    await expect(requireWorkspaceAccess()).resolves.toBeUndefined();
  });
});