export type SceneQuality = "auto" | "low" | "high";

/** Converts the saved preference and lightweight device signals into renderer limits. */
export function sceneQualityLimits(preference: SceneQuality) {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  const constrained =
    preference === "low" ||
    (preference === "auto" &&
      ((nav.deviceMemory != null && nav.deviceMemory <= 4) ||
        nav.hardwareConcurrency <= 4 ||
        nav.connection?.saveData === true ||
        nav.connection?.effectiveType === "2g"));
  return constrained
    ? { pixelRatio: 1, activeFrameMs: 66, calmFrameMs: 120 }
    : {
        pixelRatio:
          preference === "high" ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.5),
        activeFrameMs: preference === "high" ? 25 : 32,
        calmFrameMs: 100,
      };
}
