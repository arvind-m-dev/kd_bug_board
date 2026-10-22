import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { collaboratorSchema } from './onboarding';

export const generateCollaboratorOnboarding = createServerFn({ method: 'POST' })
  .validator((input: unknown) => collaboratorSchema.parse(input))
  .handler(async ({ data }) => {
    const { requireOnboardingAdmin, generateWelcome } = await import('./onboarding.server');
    await requireOnboardingAdmin();
    return generateWelcome(data, getRequest());
  });