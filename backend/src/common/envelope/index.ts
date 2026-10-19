export type Envelope<T> = {
  data: T;
};

export type PageEnvelope<T> = {
  data: T[];
  page: {
    nextCursor?: string | null;
    hasMore: boolean;
    limit: number;
  };
};

export type ErrorDetail = {
  field?: string;
  message: string;
  code?: string;
};

export type ErrorBody = {
  code: string;
  message: string;
  details?: ErrorDetail[];
  requestId?: string;
};

export type ErrorEnvelope = {
  error: ErrorBody;
};
