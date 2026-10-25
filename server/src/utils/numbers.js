// Money rounding helper — PHP round() equivalent to 2 decimals.
// migration.md §10: never use Math.round() for money without round2().
export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
