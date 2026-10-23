import { roleTag } from "@/lib/bug-workflow";

/** The person's role as a small tag next to their name: Dev, QA, Tester, Member. */
export function RoleTag({ role }: { role?: string | undefined }) {
  const tag = roleTag(role);
  return tag ? (
    <span className="bf-role-tag" data-role={role}>
      {tag}
    </span>
  ) : null;
}
