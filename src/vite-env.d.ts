/// <reference types="vite/client" />

import {
  AnalysisProgressEvent,
  AnalysisRunSummary,
  AppSettings,
  DocFileInspection,
  GapRecommendation,
  ScrubResult,
  TaxonomyAndPromptsConfig,
  TicketAnalysisVerdict,
} from './types/seer';

export interface SeerWindowApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (
    payload: Partial<AppSettings> & { cloudApiKey?: string; hubSpotToken?: string }
  ) => Promise<AppSettings>;
  selectDocsFolder: () => Promise<string | null>;
  selectTicketFile: () => Promise<string | null>;
  testOllama: (baseUrl: string) => Promise<{ ok: boolean; models: string[] }>;
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
