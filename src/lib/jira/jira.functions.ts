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
