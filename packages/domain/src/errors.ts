export type DomainErrorKind = 'invalid' | 'conflict' | 'not_found' | 'forbidden';

/** Business-rule failure, independent of transport. The API maps `kind` to an HTTP status. */
export class DomainError extends Error {
  constructor(
    public readonly kind: DomainErrorKind,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
