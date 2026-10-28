export class AuctionRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuctionRequestError';
  }
}

export class InvalidAuctionCursorError extends Error {
  constructor() {
    super('Auction cursor is invalid');
    this.name = 'InvalidAuctionCursorError';
  }
}
