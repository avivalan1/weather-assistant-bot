import type { Location } from './types.js';

/**
 * Domain errors raised by the services. The bot layer maps each one (and the
 * clients' UpstreamError) to a user-facing message; anything else is a bug.
 */

/** The user's input failed validation. `message` is safe to show to the user. */
export class InvalidInputError extends Error {
  override readonly name = 'InvalidInputError';
}

export class LocationNotFoundError extends Error {
  override readonly name = 'LocationNotFoundError';
  constructor(
    readonly placeName: string,
    /** The "Region/Country" parts the user added; empty if none. */
    readonly qualifiers: readonly string[],
    /** Places the name alone matched, when qualifiers ruled them all out. */
    readonly suggestions: readonly Location[] = [],
  ) {
    super(`No location found for "${[placeName, ...qualifiers].join(', ')}"`);
  }
}
