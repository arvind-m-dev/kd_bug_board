/**
 * Wraps a mutation that ends in `returning ...` so its audit row is written by the SAME statement, only when the
 * mutation actually changed a row. A failure between "change" and "audit" therefore can't leave history missing, and
 * a no-op retry writes no duplicate row. Parameters are appended after the mutation's own.
 */
export function audited(
  mutation: string,
  params: unknown[],
  audit: { actorId: string; bugId?: string | null; action: string; detail: object },
) {
  const n = params.length;
  return {
    query: `with done as (${mutation}), logged as (insert into bugflow.activity(id,actor_id,bug_id,action,detail) select gen_random_uuid(),$${n + 1}::uuid,$${n + 2}::bigint,$${n + 3},$${n + 4}::jsonb from (select 1 from done limit 1) x) select * from done`,
    params: [
      ...params,
      audit.actorId,
      audit.bugId ?? null,
      audit.action,
      JSON.stringify(audit.detail),
    ],
  };
}
