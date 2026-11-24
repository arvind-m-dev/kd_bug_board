/** Unsubmitted bug-report text kept in the browser. Files are never part of a draft. */
export type ReportDraft = {
  description: string;
  steps: string;
  title: string;
  projectId: string;
  module: string;
  priority: string;
  severity: string;
  expected: string;
  actual: string;
  browserDevice: string;
  environment: string;
  dueOn: string;
  codePrefix: string;
  links: string[];
};

export const REPORT_DRAFT_KEY = "bf-bug-report-draft";

export function emptyReportDraft(): ReportDraft {
  return {
    description: "",
    steps: "",
    title: "",
    projectId: "",
    module: "",
    priority: "P3",
    severity: "Medium",
    expected: "",
    actual: "",
    browserDevice: "",
    environment: "",
    dueOn: "",
    codePrefix: "",
    links: [],
  };
}

function tidy(d: ReportDraft): ReportDraft {
  return {
    description: d.description.trim(),
    steps: d.steps.trim(),
    title: d.title.trim(),
    projectId: d.projectId.trim(),
    module: d.module.trim(),
    priority: d.priority.trim() || "P3",
    severity: d.severity.trim() || "Medium",
    expected: d.expected.trim(),
    actual: d.actual.trim(),
    browserDevice: d.browserDevice.trim(),
    environment: d.environment.trim(),
    dueOn: d.dueOn.trim(),
    codePrefix: d.codePrefix.trim(),
    links: d.links.map((l) => l.trim()).filter(Boolean),
  };
}

/** True when two snapshots are the same report, ignoring surrounding whitespace. */
export function sameReportDraft(a: ReportDraft, b: ReportDraft): boolean {
  return JSON.stringify(tidy(a)) === JSON.stringify(tidy(b));
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function parseReportDraft(raw: string | null): ReportDraft | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const links = Array.isArray(o["links"])
      ? o["links"].filter((x): x is string => typeof x === "string")
      : [];
    return {
      ...emptyReportDraft(),
      description: text(o["description"]),
      steps: text(o["steps"]),
      title: text(o["title"]),
      projectId: text(o["projectId"]),
      module: text(o["module"]),
      priority: text(o["priority"]) || "P3",
      severity: text(o["severity"]) || "Medium",
      expected: text(o["expected"]),
      actual: text(o["actual"]),
      browserDevice: text(o["browserDevice"]),
      environment: text(o["environment"]),
      dueOn: text(o["dueOn"]),
      codePrefix: text(o["codePrefix"]),
      links,
    };
  } catch {
    return null;
  }
}

/** True when the report differs from a blank new bug (default priority and severity do not count). */
export function reportDraftHasContent(d: ReportDraft, countProject = false): boolean {
  const fields = [
    d.description,
    d.steps,
    d.title,
    d.module,
    d.expected,
    d.actual,
    d.browserDevice,
    d.environment,
    d.dueOn,
    ...(countProject ? [d.projectId] : []),
  ];
  if (fields.some((v) => v.trim())) return true;
  if (d.links.some((l) => l.trim())) return true;
  if (d.priority && d.priority !== "P3") return true;
  if (d.severity && d.severity !== "Medium") return true;
  return false;
}
