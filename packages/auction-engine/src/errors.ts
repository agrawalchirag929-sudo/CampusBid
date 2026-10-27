export class AuctionEngineInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'AuctionEngineInputError';
  }
}

export class TransactionRetryLimitError extends Error {
  constructor(
    readonly attempts: number,
    options?: ErrorOptions,
  ) {
    super(
      `MongoDB transaction did not succeed after ${attempts} attempts`,
      options,
    );
    this.name = 'TransactionRetryLimitError';
  }
}

export class AuctionCloseInvariantError extends Error {
  constructor(auctionId: string) {
    super(`Auction ${auctionId} changed unexpectedly while closing`);
    this.name = 'AuctionCloseInvariantError';
  }
}
