/** Shared smooth gusts keep foliage, airborne particles and grounded leaves in sync. */
export function seasonalWind(time: number) {
  return 12 + Math.sin(time * 0.23) * 18 + Math.pow(Math.max(0, Math.sin(time * 0.51)), 4) * 65;
}
export type SleighPhase = "approach" | "landing" | "walk" | "graze" | "takeoff" | "away";
type Pose = { x: number; y: number; depth: number };
export function createSleighJourney(
  random: () => number,
  landing?: () => { x: number; y: number; walkTo: number },
) {
  let walkTo: number | undefined;
  let phase: SleighPhase = "approach",
    elapsed = 0,
    duration = 10;
  let from: Pose = { x: random() < 0.5 ? -0.25 : 1.25, y: 0.45 + random() * 0.4, depth: -2.2 };
  let to: Pose = {
    x: 0.3 + random() * 0.4,
    y: 0.35 + random() * 0.4,
    depth: 0.05 + random() * 0.12,
  };
  const between = (a: number, b: number) => a + random() * (b - a);
  let bend = between(-0.25, 0.25),
    depthBend = between(-0.35, 0.04);
  // Random weaves on each flight: extra swerves and dips that still start and end exactly on the leg's joins.
  const weave = () => ({
    x: between(-0.09, 0.09),
    y: between(-0.07, 0.07),
    nx: 2 + Math.floor(random() * 3),
    ny: 2 + Math.floor(random() * 3),
    shift: between(0, Math.PI * 2),
  });
  let wobble = weave(),
    hopped = false;
  // A perch is a UI ledge (or the ground) to land on.
  const perchAt = () => {
    const perch = landing?.();
    walkTo = perch?.walkTo;
    return { x: perch?.x ?? between(0.35, 0.57), y: perch?.y ?? 0, depth: 0 };
  };
  let yaw = 0,
    pitch = 0,
    bank = 0;
  const next = () => {
    from = to;
    if (phase === "approach" && random() < 0.3) {
      // Sometimes it only flies over and leaves without landing.
      phase = "takeoff";
      duration = between(6, 10);
      to = { x: random() < 0.5 ? -0.25 : 1.25, y: between(0.55, 0.9), depth: -1.8 };
    } else if (phase === "approach") {
      phase = "landing";
      duration = between(6, 9);
      to = perchAt();
    } else if (phase === "graze" && !hopped && random() > 0.68) {
      hopped = true;
      // Or hops over to another card before leaving.
      phase = "landing";
      duration = between(4, 7);
      to = perchAt();
    } else if (phase === "landing") {
      phase = "walk";
      duration = between(4, 7);
      to = { ...from, x: walkTo ?? Math.min(0.72, from.x + between(0.08, 0.15)) };
    } else if (phase === "walk") {
      phase = "graze";
      duration = between(7, 12);
      to = { ...from };
    } else if (phase === "graze") {
      phase = "takeoff";
      duration = between(7, 10);
      to = { x: random() < 0.5 ? -0.25 : 1.25, y: between(0.6, 0.85), depth: -1.8 };
    } else if (phase === "takeoff") {
      phase = "away";
      duration = between(4, 9);
      to = { ...from };
    } else {
      phase = "approach";
      hopped = false;
      duration = between(9, 14);
      // Turn around while out of view, then re-enter through the edge we left.
      from = { ...from };
      to = { x: between(0.38, 0.63), y: between(0.45, 0.7), depth: between(0.05, 0.18) };
    }
    bend = between(-0.28, 0.28);
    depthBend = between(-0.35, 0.04);
    wobble = weave();
  };
  return (dt: number) => {
    elapsed += Math.max(0, dt);
    while (elapsed >= duration) {
      elapsed -= duration;
      next();
    }
    const p = elapsed / duration,
      smooth = p * p * (3 - 2 * p);
    const flight = phase === "approach" || phase === "landing" || phase === "takeoff";
    // A bowed 3D curve, with zero positional offset at each join.
    const point = (u: number): Pose => {
      const arc = flight ? Math.sin(Math.PI * u) ** 2 : 0;
      const sway = flight ? Math.sin(Math.PI * u) : 0;
      return {
        x:
          from.x +
          (to.x - from.x) * u +
          bend * arc +
          wobble.x * sway * Math.sin(wobble.nx * Math.PI * u + wobble.shift),
        y:
          from.y +
          (to.y - from.y) * u +
          (flight ? 0.12 * arc : 0) +
          wobble.y * sway * Math.sin(wobble.ny * Math.PI * u),
        depth: from.depth + (to.depth - from.depth) * u + depthBend * arc,
      };
    };
    const position = point(smooth);
    const tangentAt = (u: number) => {
      const a = point(Math.max(0, u - 0.001)),
        b = point(Math.min(1, u + 0.001));
      const dx = b.x - a.x,
        dy = b.y - a.y,
        dz = (b.depth - a.depth) * 0.3;
      return { yaw: Math.atan2(-dz, dx), pitch: Math.atan2(dy * 0.65, Math.hypot(dx, dz)) };
    };
    const tangent = tangentAt(smooth);
    const ahead = tangentAt(Math.min(0.999, smooth + 0.08));
    const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const turn = angle(ahead.yaw - tangent.yaw);
    const active = phase !== "graze" && phase !== "away";
    const blend = 1 - Math.exp(-Math.max(0, dt) * 3);
    if (active) {
      yaw += angle(tangent.yaw - yaw) * blend;
      pitch += (tangent.pitch - pitch) * blend;
    }
    bank += ((flight ? Math.max(-0.42, Math.min(0.42, -turn * 2)) : 0) - bank) * blend;
    const airborne =
      phase === "approach" || phase === "takeoff" ? 1 : phase === "landing" ? 1 - smooth : 0;
    return {
      phase,
      x: position.x,
      y: position.y,
      depth: position.depth,
      yaw,
      pitch,
      bank,
      scale: 1 / (1 - position.depth),
      airborne,
      grazing: phase === "graze" ? Math.min(1, elapsed / 1.5, (duration - elapsed) / 1.5) : 0,
    };
  };
}
