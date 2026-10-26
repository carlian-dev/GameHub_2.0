// Money rounding helper — rounds to 2 decimals (centavos).
// migration.md §10: never use Math.round() for money without round2().
export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
