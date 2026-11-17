import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cloudIdSchema } from "./oauth";
import { mappingConfigSchema } from "./schemas";

// Admin-only Jira operations. Each server module checks the Admin session (and same origin for changes) itself.

export const getJiraStatus = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./connection.server");
  const a = await import("../portal-access.server");
  return a.databaseCall(() => s.jiraStatus());
});

export const startJiraConnectFn = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./auth.server");
  const a = await import("../portal-access.server");
  return a.databaseCall(() => s.startJiraConnect());
});

export const checkJiraConnectionFn = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./connection.server");
  const a = await import("../portal-access.server");
  return a.databaseCall(() => s.checkJiraConnection());
});

export const selectJiraSiteFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ cloudId: cloudIdSchema }).strict().parse(v))
  .handler(async ({ data }) => {
    const s = await import("./connection.server");
    const a = await import("../portal-access.server");
    return a.databaseCall(() => s.selectJiraSite(data.cloudId));
  });

export const pauseJiraFn = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./connection.server");
  const a = await import("../portal-access.server");
  return a.databaseCall(() => s.pauseJira());
});

export const resumeJiraFn = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./connection.server");
  const a = await import("../portal-access.server");
  return a.databaseCall(() => s.resumeJira());
});

export const disconnectJiraFn = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./connection.server");
  const a = await import("../portal-access.server");
  return a.databaseCall(() => s.disconnectJira());
});

// ---- project mapping ----

const jiraId = z.string().regex(/^\d{1,20}$/);
const projectId = z.object({ projectId: z.string().uuid() }).strict();

export const getJiraResourcesFn = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./mapping.server");
  const a = await import("../portal-access.server");
  return a.databaseCall(() => s.jiraResources());
});

export const getJiraProjectShapeFn = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z.object({ jiraProjectId: jiraId, issueTypeId: jiraId.optional() }).strict().parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./mapping.server");
    const a = await import("../portal-access.server");
    return a.databaseCall(() => s.jiraProjectShape(data.jiraProjectId, data.issueTypeId));
  });

export const saveJiraMappingFn = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        jiraProjectId: jiraId,
        issueTypeId: jiraId,
        config: mappingConfigSchema,
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) => {
    const s = await import("./mapping.server");
    const a = await import("../portal-access.server");
    return a.databaseCall(() => s.saveJiraMapping(data));
  });

export const previewJiraMappingFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => projectId.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./mapping.server");
    const a = await import("../portal-access.server");
    return a.databaseCall(() => s.previewJiraMapping(data.projectId));
  });

export const activateJiraMappingFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => projectId.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./mapping.server");
    const a = await import("../portal-access.server");
    return a.databaseCall(() => s.activateJiraMapping(data.projectId));
  });

export const pauseJiraMappingFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => projectId.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./mapping.server");
    const a = await import("../portal-access.server");
    return a.databaseCall(() => s.pauseJiraMapping(data.projectId));
  });

export const previewJiraInitialSyncFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => projectId.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./mapping.server");
    const a = await import("../portal-access.server");
    return a.databaseCall(() => s.initialSyncPreview(data.projectId));
  });

export const startJiraInitialSyncFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => projectId.parse(v))
  .handler(async ({ data }) => {
    const s = await import("./mapping.server");
    const a = await import("../portal-access.server");
    return a.databaseCall(() => s.startInitialSync(data.projectId));
  });

// ---- running sync: health, conflicts, people ----

const run = async <T>(work: () => Promise<T>) =>
  (await import("../portal-access.server")).databaseCall(work);

export const getJiraOverviewFn = createServerFn({ method: "POST" }).handler(async () =>
  run(async () => (await import("./admin.server")).jiraOverview()),
);

export const resolveJiraConflictFn = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        conflictId: z.string().uuid(),
        resolution: z.enum(["use_bugflow", "use_jira", "ignore", "unlink"]),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) =>
    run(async () =>
      (await import("./admin.server")).resolveJiraConflict(data.conflictId, data.resolution),
    ),
  );

export const retryJiraParkedFn = createServerFn({ method: "POST" }).handler(async () =>
  run(async () => (await import("./admin.server")).retryJiraParked()),
);

export const syncJiraNowFn = createServerFn({ method: "POST" }).handler(async () =>
  run(async () => (await import("./admin.server")).syncJiraNow()),
);

export const getJiraPeopleFn = createServerFn({ method: "POST" }).handler(async () =>
  run(async () => (await import("./people.server")).jiraPeople()),
);

export const findJiraAccountsFn = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({ query: z.string().trim().min(2).max(100) })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) =>
    run(async () => (await import("./people.server")).findJiraAccounts(data.query)),
  );

export const linkJiraPersonFn = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        accountId: z.string().min(1).max(128),
        name: z.string().trim().min(1).max(200),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) =>
    run(async () =>
      (await import("./people.server")).linkJiraPerson(data.userId, {
        accountId: data.accountId,
        name: data.name,
      }),
    ),
  );

export const unlinkJiraPersonFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ userId: z.string().uuid() }).strict().parse(v))
  .handler(async ({ data }) =>
    run(async () => (await import("./people.server")).unlinkJiraPerson(data.userId)),
  );

export const matchJiraPeopleFn = createServerFn({ method: "POST" }).handler(async () =>
  run(async () => (await import("./people.server")).matchJiraPeopleByEmail()),
);

export const getJiraOnlyPeopleFn = createServerFn({ method: "POST" }).handler(async () =>
  run(async () => (await import("./people.server")).jiraOnlyPeople()),
);

export const linkJiraPersonByEmailFn = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(320),
        accountId: z.string().min(1).max(128),
        name: z.string().trim().min(1).max(200),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) =>
    run(async () =>
      (await import("./people.server")).linkJiraPersonByEmail(data.email, {
        accountId: data.accountId,
        name: data.name,
      }),
    ),
  );

export const syncJiraMembersFn = createServerFn({ method: "POST" }).handler(async () =>
  run(async () => (await import("./people.server")).syncJiraMembers()),
);

export const getJiraSyncLogFn = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        filter: z.enum(["all", "to_jira", "from_jira", "decision", "setup", "error"]),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) =>
    run(async () => (await import("./admin.server")).jiraSyncLog(data.filter)),
  );

export const applyJiraNameFn = createServerFn({ method: "POST" })
  .validator((v: unknown) => z.object({ userId: z.string().uuid() }).strict().parse(v))
  .handler(async ({ data }) =>
    run(async () => (await import("./people.server")).applyJiraName(data.userId)),
  );

export const getJiraDuplicatesFn = createServerFn({ method: "POST" }).handler(async () =>
  run(async () => (await import("./mapping.server")).jiraBugDuplicates()),
);

export const ignoreJiraDuplicateFn = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        key: z
          .string()
          .regex(/^(pair:\d+:\d+|bb:[\d,]+|jira:[\d,]+)$/)
          .max(2000),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) =>
    run(async () => (await import("./mapping.server")).ignoreJiraDuplicate(data.key)),
  );

export const linkJiraDuplicateFn = createServerFn({ method: "POST" })
  .validator((v: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        bugId: z.string().regex(/^\d{1,18}$/),
        issueId: z.string().regex(/^\d{1,20}$/),
      })
      .strict()
      .parse(v),
  )
  .handler(async ({ data }) =>
    run(async () =>
      (await import("./mapping.server")).linkJiraDuplicate(
        data.projectId,
        data.bugId,
        data.issueId,
      ),
    ),
  );
