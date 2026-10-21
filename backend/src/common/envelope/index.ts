export type Envelope<T> = {
  data: T;
};

export type PageInfo = {
  nextCursor?: string | null;
  hasMore: boolean;
  limit: number;
};

export type PageEnvelope<T> = {
  data: T[];
  page: PageInfo;
};

export type ErrorDetail = {
  field?: string;
  message?: string;
  issue?: string;
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

export function envelope<T>(data: T): Envelope<T> {
  return { data };
}

export function pageEnvelope<T>(data: T[], page: PageInfo): PageEnvelope<T> {
  return { data, page };
}
