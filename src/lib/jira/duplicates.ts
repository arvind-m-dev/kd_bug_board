// Possible double entry between Bug Board and Jira: bugs with the same title. Pure, so the rules are tested once.
// Nothing here changes anything; an Admin links a pair, or marks a finding as not a duplicate.

export type DupLocal = { bugId: string; code: string; title: string; issueKey: string | null };
export type DupRemote = { issueId: string; key: string; title: string; linked: boolean };

export type BugDuplicates = {
  /** One Bug Board bug and one Jira issue, neither linked, with the same title: probably one bug entered twice. */
  pairs: {
    key: string;
    bugId: string;
    code: string;
    issueId: string;
    issueKey: string;
    title: string;
  }[];
  /** Two or more Bug Board bugs with the same title. */
  inBugBoard: {
    key: string;
    title: string;
    bugs: { bugId: string; code: string; issueKey: string | null }[];
  }[];
  /** Two or more Jira issues with the same title. */
  inJira: { key: string; title: string; issues: { issueId: string; key: string }[] }[];
};

/** Titles compared ignoring case, punctuation and spacing. */
export const titleKey = (title: string) =>
  title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function groups<T>(items: T[], title: (t: T) => string) {
  const by = new Map<string, T[]>();
  for (const item of items) {
    const k = titleKey(title(item));
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), item]);
  }
  return by;
}

export function bugDuplicates(
  local: DupLocal[],
  remote: DupRemote[],
  ignored: ReadonlySet<string> = new Set(),
): BugDuplicates {
  const localBy = groups(local, (b) => b.title);
  const remoteBy = groups(remote, (r) => r.title);
  const pairs: BugDuplicates["pairs"] = [];
  for (const [k, bugs] of localBy) {
    const free = bugs.filter((b) => !b.issueKey);
    const open = (remoteBy.get(k) ?? []).filter((r) => !r.linked);
    // Only an unambiguous pair is offered for linking; anything else shows up in the groups below.
    if (free.length !== 1 || open.length !== 1) continue;
    const key = `pair:${free[0]!.bugId}:${open[0]!.issueId}`;
    if (!ignored.has(key))
      pairs.push({
        key,
        bugId: free[0]!.bugId,
        code: free[0]!.code,
        issueId: open[0]!.issueId,
        issueKey: open[0]!.key,
        title: free[0]!.title,
      });
  }
  const localGroups = [...localBy.values()].filter((bugs) => bugs.length > 1);
  // A Jira group that is exactly the issues of a Bug Board group is the same finding seen from Jira: shown once.
  const mirrored = new Set(
    localGroups.map((bugs) =>
      bugs
        .map((b) => b.issueKey ?? "")
        .sort()
        .join(","),
    ),
  );
  const inBugBoard = localGroups
    .map((bugs) => ({
      key: `bb:${bugs
        .map((b) => b.bugId)
        .sort()
        .join(",")}`,
      title: bugs[0]!.title,
      bugs: bugs.map(({ bugId, code, issueKey }) => ({ bugId, code, issueKey })),
    }))
    .filter((g) => !ignored.has(g.key));
  const inJira = [...remoteBy.values()]
    .filter((issues) => issues.length > 1)
    .filter(
      (issues) =>
        !mirrored.has(
          issues
            .map((i) => i.key)
            .sort()
            .join(","),
        ),
    )
    .map((issues) => ({
      key: `jira:${issues
        .map((i) => i.issueId)
        .sort()
        .join(",")}`,
      title: issues[0]!.title,
      issues: issues.map(({ issueId, key }) => ({ issueId, key })),
    }))
    .filter((g) => !ignored.has(g.key));
  return { pairs, inBugBoard, inJira };
}

export const duplicateCount = (d: BugDuplicates) =>
  d.pairs.length + d.inBugBoard.length + d.inJira.length;
