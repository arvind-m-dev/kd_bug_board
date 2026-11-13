// Pure checks over the two people lists (BugFlow members, Jira people) for the Admin's "Sync members" report.
// Nothing here changes anything: it only points at what may be the same person twice, so an Admin decides.

export type MemberRow = {
  userId: string;
  name: string;
  accountId: string | null;
  links: number;
  /** The Jira name saved when they were linked. */
  jiraName?: string | null;
};
export type JiraRow = { accountId: string; name: string; member: string | null };

export type PeopleReport = {
  linked: number;
  onlyInBugBoard: number;
  onlyInJira: number;
  /** Two or more BugFlow members with the same name (ignoring case and spaces). */
  sameNameMembers: { name: string; count: number }[];
  /** A member with more than one working portal link. */
  extraLinks: { name: string; links: number }[];
  /** Two or more Jira people with the same name: easy to link the wrong one. */
  sameNameInJira: { name: string; count: number }[];
  /** An unlinked member and an unlinked Jira person with the same name: probably one person. */
  likelySame: { userId: string; member: string; accountId: string; jiraName: string }[];
  /** A linked member whose Bug Board name is not their Jira name (Jira owns names; the Admin decides). */
  nameDiffers: { userId: string; member: string; jiraName: string }[];
};

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

function repeated(names: string[]) {
  const seen = new Map<string, { name: string; count: number }>();
  for (const n of names) {
    const k = key(n);
    const hit = seen.get(k);
    if (hit) hit.count++;
    else seen.set(k, { name: n.trim(), count: 1 });
  }
  return [...seen.values()].filter((v) => v.count > 1);
}

export function peopleReport(members: MemberRow[], jira: JiraRow[]): PeopleReport {
  const linkedAccounts = new Set(members.flatMap((m) => (m.accountId ? [m.accountId] : [])));
  const freeJira = jira.filter((j) => !j.member && !linkedAccounts.has(j.accountId));
  const unlinked = members.filter((m) => !m.accountId);
  const likelySame = unlinked.flatMap((m) => {
    const hits = freeJira.filter((j) => key(j.name) === key(m.name));
    // Only an unambiguous pair is suggested; two Jira people with this name is reported separately.
    return hits.length === 1
      ? [
          {
            userId: m.userId,
            member: m.name,
            accountId: hits[0]!.accountId,
            jiraName: hits[0]!.name,
          },
        ]
      : [];
  });
  return {
    linked: members.length - unlinked.length,
    onlyInBugBoard: unlinked.length,
    onlyInJira: freeJira.length,
    sameNameMembers: repeated(members.map((m) => m.name)),
    extraLinks: members.filter((m) => m.links > 1).map((m) => ({ name: m.name, links: m.links })),
    sameNameInJira: repeated(jira.map((j) => j.name)),
    likelySame,
    nameDiffers: members.flatMap((m) => {
      if (!m.accountId) return [];
      // Jira's current name when it was just read, else the one saved at linking.
      const jiraName = (
        jira.find((j) => j.accountId === m.accountId)?.name ??
        m.jiraName ??
        ""
      ).trim();
      return jiraName && key(jiraName) !== key(m.name)
        ? [{ userId: m.userId, member: m.name, jiraName }]
        : [];
    }),
  };
}

/** How many things in the report need an Admin's look. */
export const reportIssues = (r: PeopleReport) =>
  r.sameNameMembers.length +
  r.extraLinks.length +
  r.sameNameInJira.length +
  r.likelySame.length +
  r.nameDiffers.length;
