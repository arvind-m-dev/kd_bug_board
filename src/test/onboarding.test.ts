import { describe, it, expect } from 'vitest';
import { collaboratorSchema, onboardingContext, rolePermissions } from '@/lib/onboarding';

const member = { name: 'Example', email: 'example@example.test', role: 'developer' as const, scope: 'Test project', context: '', permissions: ['view' as const, 'recheck' as const] };
describe('Collaborator onboarding permissions', () => {
  it('developers cannot request QA verification permission', () => expect(collaboratorSchema.safeParse({ ...member, permissions: ['verify'] }).success).toBe(false));
  it('testers cannot request developer assignment permission', () => expect(collaboratorSchema.safeParse({ ...member, role: 'tester', permissions: ['assign'] }).success).toBe(false));
  it('QA may request verification of fixes', () => expect(collaboratorSchema.safeParse({ ...member, role: 'qa', permissions: ['verify'] }).success).toBe(true));
  it('other collaborators cannot request validation permission', () => expect(collaboratorSchema.safeParse({ ...member, role: 'other', permissions: ['validate'] }).success).toBe(false));
  it('sends only selected permissions to the model', () => expect(onboardingContext(member).permissions).toEqual(['View scoped bugs', 'Request QA retest']));
  it('does not send member email to the model', () => expect(onboardingContext(member)).not.toHaveProperty('email'));
  it('all four collaborator roles have separate permission choices', () => expect(Object.keys(rolePermissions)).toEqual(['tester', 'developer', 'qa', 'other']));
});