/// <reference types="vite/client" />

import {
  AccuracyMetrics,
  AnalysisProgressEvent,
  AnalysisRunSummary,
  AppSettings,
  CalibrationExample,
  DocFileInspection,
  GapRecommendation,
  LeadershipReportBundle,
  ScrubResult,
  ShippedFixRecord,
  TaxonomyAndPromptsConfig,
  TicketAnalysisVerdict,
  TrendsComparisonResult,
  VerdictAuditPayload,
} from './types/seer';

export interface SeerWindowApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (
    payload: Partial<AppSettings> & { cloudApiKey?: string; hubSpotToken?: string }
  ) => Promise<AppSettings>;
  selectDocsFolder: () => Promise<string | null>;
  selectTicketFile: () => Promise<string | null>;
  testOllama: (baseUrl: string) => Promise<{ ok: boolean; models: string[] }>;
  listOpenCodeZenModels: (baseUrl?: string) => Promise<{ ok: boolean; models: string[] }>;
  testDocsRepo: (repoPath: string) => Promise<{
    ok: boolean;
    chunkCount: number;
    fileCount: number;
    sampleTitles: string[];
  }>;
  previewPiiScrub: (
    rawText: string,
    customerName?: string,
    agentName?: string
  ) => Promise<ScrubResult>;
  getRuns: () => Promise<AnalysisRunSummary[]>;
  getRunDetails: (runId: string) => Promise<{
    run: AnalysisRunSummary | null;
    verdicts: TicketAnalysisVerdict[];
    recommendations: GapRecommendation[];
  }>;
  inspectDocFile: (relativePath: string) => Promise<DocFileInspection>;
  openDocInExplorer: (relativePath: string) => Promise<boolean>;
  getTaxonomy: () => Promise<TaxonomyAndPromptsConfig>;
  saveTaxonomy: (config: TaxonomyAndPromptsConfig) => Promise<TaxonomyAndPromptsConfig>;
  resetTaxonomy: () => Promise<TaxonomyAndPromptsConfig>;
  submitVerdictAudit: (payload: VerdictAuditPayload) => Promise<{
    verdict: TicketAnalysisVerdict;
    recommendations: GapRecommendation[];
    metrics: AccuracyMetrics;
    calibrationExamples: CalibrationExample[];
  }>;
  getAccuracyMetrics: (runId?: string) => Promise<AccuracyMetrics>;
  getCalibrationExamples: () => Promise<CalibrationExample[]>;
  deleteCalibrationExample: (exampleId: string) => Promise<CalibrationExample[]>;
  getShippedFixes: () => Promise<ShippedFixRecord[]>;
  markRecommendationShipped: (
    recommendationId: string,
    notes?: string
  ) => Promise<ShippedFixRecord[]>;
  deleteShippedFix: (fixId: string) => Promise<ShippedFixRecord[]>;
  getTrendsAndReport: (
    currentRunId?: string,
    previousRunId?: string
  ) => Promise<{
    trends: TrendsComparisonResult;
    report: LeadershipReportBundle | null;
  }>;
  seedPreviousWeekBaselineRun: () => Promise<{
    baselineRunId: string;
    shippedFixes: ShippedFixRecord[];
  }>;
  exportReportToFile: (
    format: 'html' | 'markdown',
    content: string
  ) => Promise<string | null>;
  runAnalysis: (params: {
    sourceMode: 'csv' | 'hubspot' | 'sample';
    ticketFilePath?: string;
    dateRangeStart: string;
    dateRangeEnd: string;
  }) => Promise<{
    run: AnalysisRunSummary;
    verdicts: TicketAnalysisVerdict[];
    recommendations: GapRecommendation[];
    indexedDocCount: number;
  }>;
  onAnalysisProgress: (callback: (event: AnalysisProgressEvent) => void) => () => void;
}

declare global {
  interface Window {
    seerApi: SeerWindowApi;
  }
}
