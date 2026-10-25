export type UpstreamFailure =
  | 'timeout'
  | 'network'
  | 'http' // non-2xx status other than 429
  | 'rate_limited' // upstream 429 or our own limiter refused the call
  | 'invalid_response'; // body was not JSON or failed schema validation

/** An Open-Meteo call failed. `service` names which API, for logs. */
export class UpstreamError extends Error {
  override readonly name = 'UpstreamError';
  constructor(
    readonly service: string,
    readonly failure: UpstreamFailure,
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  /**
   * Worth retrying once: the same request may well succeed a moment later.
   * Timeouts are included because, in practice, they are mostly one-off
   * connection stalls while healthy responses take well under a second.
   */
  get isTransient(): boolean {
    return (
      this.failure === 'network' ||
      this.failure === 'timeout' ||
      (this.failure === 'http' && (this.status ?? 0) >= 500)
    );
  }
}
