/** Decorative mean lunar phase, not an astronomical ephemeris.
 * Mean synodic month: https://eclipse.gsfc.nasa.gov/phase/phasecat.html
 * Epoch: new moon, 6 January 2000, 18:14 UTC. */
export function moonPhase(date: Date) {
  const cycles = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / (29.530588 * 86400000);
  return ((cycles % 1) + 1) % 1;
}
