// API contracts (Zod, shared by apps/web and apps/api)
export * from './api.ts';
export * from './world.ts';

export type CheckStatus = 'passed' | 'failed' | 'inconclusive' | 'unavailable';
export type PublicationState = 'scheduled' | 'submitting' | 'verifying' | 'published' | 'unknown' | 'failed' | 'blocked';

export interface EventDraftContract {
  eventType: string;
  subjectId: string;
  predicate: string;
  value: unknown;
  storyTime?: number;
  evidence?: string;
  plotNodeId?: string;
}

export interface GenerateChapterResponseContract {
  content: string;
  proposedEvents: EventDraftContract[];
  observedEvents?: EventDraftContract[];
}

export interface ContextManifestContract {
  workId: string;
  chapterNumber: number;
  stateRevision: number;
  constraintRevision?: number;
  worldPackRevision?: number;
  storyBibleRevision?: number;
  adoptedVersionIds: string[];
  includedEventIds: string[];
  requiredMaterialStatus: 'complete' | 'needs_split' | 'blocked';
  omittedOptionalMaterial: string[];
  estimatedTokens?: number;
  contextBudget?: number;
  canonHash?: string;
  stateHash?: string;
}

export interface CheckExecutionContract {
  checker: string;
  status: CheckStatus;
  candidateId: string;
  message?: string;
  evidence?: string[];
}

export interface TaskEnvelopeContract {
  taskId: string;
  workId: string;
  kind: 'generate_chapter' | 'extract_events' | 'review' | 'adopt' | 'projection' | 'publish';
  inputVersionIds: string[];
  attempt: number;
  idempotencyKey: string;
}

export interface PublicationIntentContract {
  id: string;
  workId: string;
  chapterVersionId: string;
  platform: string;
  state: PublicationState;
  scheduledAt?: string;
  snapshotHash: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ContractValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`contract validation failed: ${issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`);
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

function validateEvent(value: unknown, path: string, issues: ValidationIssue[]): value is EventDraftContract {
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object' });
    return false;
  }
  for (const field of ['eventType', 'subjectId', 'predicate']) if (!isNonEmptyString(value[field])) issues.push({ path: `${path}.${field}`, message: 'must be a non-empty string' });
  if ('storyTime' in value && value.storyTime !== undefined && (!Number.isInteger(value.storyTime) || (value.storyTime as number) < 0)) issues.push({ path: `${path}.storyTime`, message: 'must be a non-negative integer' });
  if ('evidence' in value && value.evidence !== undefined && typeof value.evidence !== 'string') issues.push({ path: `${path}.evidence`, message: 'must be a string' });
  return issues.every((issue) => !issue.path.startsWith(path));
}

export function parseGenerateChapterResponse(input: unknown): GenerateChapterResponseContract {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) throw new ContractValidationError([{ path: '$', message: 'must be an object' }]);
  if (!isNonEmptyString(input.content)) issues.push({ path: '$.content', message: 'must be a non-empty string' });
  if (!Array.isArray(input.proposedEvents)) issues.push({ path: '$.proposedEvents', message: 'must be an array' });
  else input.proposedEvents.forEach((event, index) => validateEvent(event, `$.proposedEvents[${index}]`, issues));
  if (input.observedEvents !== undefined) {
    if (!Array.isArray(input.observedEvents)) issues.push({ path: '$.observedEvents', message: 'must be an array' });
    else input.observedEvents.forEach((event, index) => validateEvent(event, `$.observedEvents[${index}]`, issues));
  }
  if (issues.length) throw new ContractValidationError(issues);
  return input as unknown as GenerateChapterResponseContract;
}

export function parseContextManifest(input: unknown): ContextManifestContract {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) throw new ContractValidationError([{ path: '$', message: 'must be an object' }]);
  if (!isNonEmptyString(input.workId)) issues.push({ path: '$.workId', message: 'must be a non-empty string' });
  if (!Number.isInteger(input.chapterNumber) || (input.chapterNumber as number) < 1) issues.push({ path: '$.chapterNumber', message: 'must be a positive integer' });
  if (!Number.isInteger(input.stateRevision) || (input.stateRevision as number) < 0) issues.push({ path: '$.stateRevision', message: 'must be a non-negative integer' });
  if (input.constraintRevision !== undefined && (!Number.isInteger(input.constraintRevision) || (input.constraintRevision as number) < 0)) issues.push({ path: '$.constraintRevision', message: 'must be a non-negative integer' });
  for (const field of ['worldPackRevision', 'storyBibleRevision']) if (input[field] !== undefined && (!Number.isInteger(input[field]) || (input[field] as number) < 1)) issues.push({ path: `$.${field}`, message: 'must be a positive integer' });
  if (!isStringArray(input.adoptedVersionIds)) issues.push({ path: '$.adoptedVersionIds', message: 'must be a string array' });
  if (!isStringArray(input.includedEventIds)) issues.push({ path: '$.includedEventIds', message: 'must be a string array' });
  if (!['complete', 'needs_split', 'blocked'].includes(String(input.requiredMaterialStatus))) issues.push({ path: '$.requiredMaterialStatus', message: 'has an invalid status' });
  if (!isStringArray(input.omittedOptionalMaterial)) issues.push({ path: '$.omittedOptionalMaterial', message: 'must be a string array' });
  if (issues.length) throw new ContractValidationError(issues);
  return input as unknown as ContextManifestContract;
}

export function parseTaskEnvelope(input: unknown): TaskEnvelopeContract {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) throw new ContractValidationError([{ path: '$', message: 'must be an object' }]);
  for (const field of ['taskId', 'workId', 'idempotencyKey']) if (!isNonEmptyString(input[field])) issues.push({ path: `$.${field}`, message: 'must be a non-empty string' });
  if (!['generate_chapter', 'extract_events', 'review', 'adopt', 'projection', 'publish'].includes(String(input.kind))) issues.push({ path: '$.kind', message: 'has an invalid task kind' });
  if (!isStringArray(input.inputVersionIds)) issues.push({ path: '$.inputVersionIds', message: 'must be a string array' });
  if (!Number.isInteger(input.attempt) || (input.attempt as number) < 1) issues.push({ path: '$.attempt', message: 'must be a positive integer' });
  if (issues.length) throw new ContractValidationError(issues);
  return input as unknown as TaskEnvelopeContract;
}

export const schemas = {
  generateChapterResponse: {
    type: 'object', required: ['content', 'proposedEvents'], additionalProperties: false,
    properties: { content: { type: 'string', minLength: 1 }, proposedEvents: { type: 'array' }, observedEvents: { type: 'array' } },
  },
  contextManifest: {
    type: 'object', required: ['workId', 'chapterNumber', 'stateRevision', 'adoptedVersionIds', 'includedEventIds', 'requiredMaterialStatus', 'omittedOptionalMaterial'], additionalProperties: false,
  },
  taskEnvelope: {
    type: 'object', required: ['taskId', 'workId', 'kind', 'inputVersionIds', 'attempt', 'idempotencyKey'], additionalProperties: false,
  },
} as const;
