import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const run = async <T>(work: (s: typeof import("./mcp-config.server")) => Promise<T>) => {
  const s = await import("./mcp-config.server");
  const a = await import("./portal-access.server");
  return a.databaseCall(() => work(s));
};
const schema = z.object({ enabled: z.boolean(), oauth: z.boolean() }).strict();
export const getMcpConfig = createServerFn({ method: "GET" }).handler(() =>
  run((s) => s.mcpConfig()),
);
export const saveMcpConfig = createServerFn({ method: "POST" })
  .validator((v: unknown) => schema.parse(v))
  .handler(({ data }) => run((s) => s.saveMcpConfig(data)));
