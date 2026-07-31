/**
 * Perchance API error hierarchy.
 */

export class PerchanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerchanceError";
  }
}

export class ConnectionError extends PerchanceError {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

export class AuthenticationError extends PerchanceError {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends PerchanceError {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class GalleryNotFoundError extends PerchanceError {
  constructor(message: string) {
    super(message);
    this.name = "GalleryNotFoundError";
  }
}

export class GalleryProtocolError extends PerchanceError {
  constructor(message: string) {
    super(message);
    this.name = "GalleryProtocolError";
  }
}
