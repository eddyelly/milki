/**
 * Errors thrown by the chaincode. The Error message is a JSON envelope so the backend can map it
 * straight to `{ error: { code, message, details } }` (CLAUDE.md §12) and show the human-readable
 * message to users (CLAUDE.md §8: "This parcel has an active mortgage with CRDB Bank").
 */
export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'PARCEL_ENCUMBERED'
  | 'PARCEL_DISPUTED'
  | 'PARCEL_FROZEN'
  | 'PARCEL_RETIRED'
  | 'TRANSFER_IN_PROGRESS';

export type ErrorDetails = Record<string, string | number | boolean | null>;

export class MilkiError extends Error {
  public readonly code: ErrorCode;
  public readonly humanMessage: string;
  public readonly details: ErrorDetails | undefined;

  constructor(code: ErrorCode, humanMessage: string, details?: ErrorDetails) {
    super(JSON.stringify(details ? { code, message: humanMessage, details } : { code, message: humanMessage }));
    this.name = 'MilkiError';
    this.code = code;
    this.humanMessage = humanMessage;
    this.details = details;
  }
}

export const invalid = (message: string, details?: ErrorDetails): MilkiError =>
  new MilkiError('INVALID_ARGUMENT', message, details);
export const notFound = (message: string, details?: ErrorDetails): MilkiError =>
  new MilkiError('NOT_FOUND', message, details);
export const forbidden = (message: string, details?: ErrorDetails): MilkiError =>
  new MilkiError('FORBIDDEN', message, details);
export const conflict = (message: string, details?: ErrorDetails): MilkiError =>
  new MilkiError('CONFLICT', message, details);
export const invalidState = (message: string, details?: ErrorDetails): MilkiError =>
  new MilkiError('INVALID_STATE', message, details);
