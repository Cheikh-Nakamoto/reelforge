// cut-the-curve §7: a single ease (power3.inOut) smacks the group to a stop; a ramp-in, a linear burst and a tail
// at least three times the ramp-in read as a purposeful slide. Fractions are of the distance and of the time.
export const NUDGE = [
  { to: 0.1, time: 0.2, ease: "power3.in" },
  { to: 0.75, time: 0.18, ease: "none" },
  { to: 1, time: 0.62, ease: "power4.out" },
] as const;
