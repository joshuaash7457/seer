export type AIProviderType = 'opencode-zen' | 'ollama' | 'openai' | 'anthropic' | 'gemini';

export type GapVerdictType =
  | 'NO_DOC'
  | 'PARTIAL_COVERAGE'
  | 'COVERED_FOUND_UNHELPFUL'
  | 'COVERED_HARD_TO_FIND'
  | 'NEEDS_TOOL'
  | 'WELL_COVERED';

export type FixType =
  | 'NEW_ARTICLE'
  | 'EDIT_ARTICLE'
  | 'IMPROVE_FINDABILITY'
  | 'BUILD_TOOL'
  | 'NONE';

export interface AppSettings {
  docsRepoPath: string;
  aiProvider: AIProviderType;
  ollamaBaseUrl: string;
  ollamaModel: string;
  openCodeZenBaseUrl: string;
  openCodeZenModel: string;
  cloudModel: string;
  hasCloudApiKey: boolean;
  hasHubSpotToken: boolean;
  hubSpotPipelineFilter: string;
}

export interface TaxonomyAndPromptsConfig {
  products: string[];
  categories: string[];
  nonSelfServiceKeywords: string[];
  extractionSystemPrompt: string;
  judgeSystemPrompt: string;
}

export interface ScrubResult {
  scrubbedText: string;
  redactionCount: number;
  redactionSummary: Record<string, number>;
}

export interface RawTicketInput {
  externalId: string;
  subject: string;
  content: string;
  threadText?: string;
  createdAt: string;
  status?: string;
  pipeline?: string;
  customerName?: string;
  customerEmail?: string;
  agentName?: string;
}

export interface ScrubbedTicket {
  id: string;
  externalId: string;
  subject: string;
  scrubbedBody: string;
  createdAt: string;
  status: string;
  redactionCount: number;
}

export interface DocChunk {
  id: string;
  filePath: string;
  relativePath: string;
  title: string;
  sectionHeading: string;
  urlSlug: string;
  products: string[];
  content: string;
  wordCount: number;
  fileHash: string;
}

export interface TicketAnalysisVerdict {
  id: string;
  runId: string;
  ticketId: string;
  externalId: string;
  createdAt: string;
  isSelfServiceable: boolean;
  nonSelfServiceReason?: string;
  product: string;
  category: string;
  customerQuestion: string;
  resolutionSummary: string;
  verdict: GapVerdictType;
  fixType: FixType;
  matchedDocPath: string | null;
  matchedDocTitle: string | null;
  confidence: number;
  gapReasoning: string;
  recommendedAction: string;
  suggestedTitleOrSection: string;
  scrubbedSnippet: string;
  originalVerdict?: GapVerdictType;
  originalFixType?: FixType;
  humanAudit?: 'approved' | 'corrected' | null;
  humanCorrectionNote?: string | null;
  auditedAt?: string | null;
}

export interface CalibrationExample {
  id: string;
  createdAt: string;
  ticketExternalId: string;
  product: string;
  category: string;
  customerQuestion: string;
  matchedDocPath: string | null;
  seerOriginalVerdict: GapVerdictType;
  verifiedVerdict: GapVerdictType;
  verifiedFixType: FixType;
  humanNote: string;
  auditType: 'approved' | 'corrected';
}

export interface VerdictAuditPayload {
  verdictId: string;
  auditStatus: 'approved' | 'corrected';
  correctedVerdict?: GapVerdictType;
  correctedFixType?: FixType;
  correctedDocPath?: string | null;
  correctedRecommendedAction?: string;
  humanNote?: string;
}

export interface AccuracyMetrics {
  totalVerdicts: number;
  auditedCount: number;
  approvedCount: number;
  correctedCount: number;
  agreementRatePercent: number | null;
  calibrationExamplesCount: number;
  byVerdict: Record<
    GapVerdictType,
    { total: number; audited: number; approved: number; corrected: number }
  >;
}

export interface GapRecommendation {
  id: string;
  runId: string;
  title: string;
  product: string;
  category: string;
  verdict: GapVerdictType;
  fixType: FixType;
  ticketCount: number;
  priorityScore: number;
  targetDocPath: string | null;
  targetDocTitle: string | null;
  whyDocsFailed: string;
  concreteAction: string;
  exampleQuestions: string[];
  resolutionSummaries: string[];
  draftMdxOutline: string;
  ticketIds: string[];
}

export interface DocFileInspection {
  found: boolean;
  relativePath: string;
  absolutePath: string;
  title: string;
  rawMdx: string;
  expandedText: string;
  wordCount: number;
}

export interface AnalysisRunSummary {
  id: string;
  startedAt: string;
  completedAt: string | null;
  sourceType: 'csv' | 'hubspot';
  sourceLabel: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  totalTickets: number;
  selfServiceableTickets: number;
  gapTicketsCount: number;
  aiProvider: string;
  aiModel: string;
  status: 'running' | 'completed' | 'failed';
  errorMessage?: string;
}

export interface AnalysisProgressEvent {
  runId: string;
  stage: 'ingesting' | 'indexing_docs' | 'analyzing_tickets' | 'clustering' | 'completed' | 'error';
  current: number;
  total: number;
  message: string;
}
