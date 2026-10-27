import { createServerFn } from "@tanstack/react-start";

export const getSystemHealth = createServerFn({ method: "POST" }).handler(async () => {
  const s = await import("./system-health.server");
  const a = await import("./portal-access.server");
  return a.databaseCall(() => s.systemHealth());
});
export const getStorageAlarms = createServerFn({ method: "GET" }).handler(async () => {
  const s = await import("./system-health.server");
  const a = await import("./portal-access.server");
  return a.databaseCall(() => s.storageAlarms());
});
