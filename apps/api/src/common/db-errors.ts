/** True when a query failed on the given Postgres unique constraint (drizzle wraps pg errors in `cause`). */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const pgErr = (err as { cause?: { code?: string; constraint?: string } })?.cause ?? (err as { code?: string; constraint?: string });
  return pgErr?.code === '23505' && pgErr.constraint === constraint;
}
