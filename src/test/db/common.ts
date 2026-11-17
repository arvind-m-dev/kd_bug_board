import { bugChangeSchema, editSchema, reportSchema } from "@/lib/bug-workflow";
import { bugDetail, changeBug, editBugReport, reportBug } from "@/lib/bug-workflow.server";
import { PROJECT } from "./local";

export const admin = { kind: "admin" } as const;
export const report = (over: Record<string, unknown> = {}) =>
  reportSchema.parse({
    requestId: crypto.randomUUID(),
    projectId: PROJECT,
    title: "TRIAL-JIRA-Checkout button does nothing",
    description: "Clicking Pay does nothing.",
    steps: ["Open the cart", "Click Pay"],
    expected: "The payment page opens.",
    actual: "Nothing happens.",
    severity: "High",
    priority: "P2",
    environment: "Staging",
    module: "Checkout",
    ...over,
  });
export const create = async (over: Record<string, unknown> = {}) =>
  (await reportBug(admin, report(over))).id;
export const version = async (id: string) => (await bugDetail(admin, id)).bug.version;
export const change = async (id: string, data: Record<string, unknown>) =>
  changeBug(
    admin,
    bugChangeSchema.parse({
      requestId: crypto.randomUUID(),
      id,
      version: await version(id),
      ...data,
    }),
  );
export async function edit(id: string, over: Record<string, unknown>) {
  const { bug } = await bugDetail(admin, id);
  return editBugReport(
    admin,
    editSchema.parse({
      id,
      version: bug.version,
      title: bug.title,
      description: bug.description,
      steps: bug.steps,
      expected: bug.expected,
      actual: bug.actual,
      severity: bug.severity,
      priority: bug.priority,
      environment: bug.environment,
      module: bug.module,
      browserDevice: bug.browserDevice,
      dueOn: bug.dueOn ?? "",
      ...over,
    }),
  );
}
