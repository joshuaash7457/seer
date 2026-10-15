import { contextBridge, ipcRenderer } from 'electron';
import {
  AnalysisProgressEvent,
  AppSettings,
  TaxonomyAndPromptsConfig,
  VerdictAuditPayload,
} from '../src/types/seer';

contextBridge.exposeInMainWorld('seerApi', {
  getSettings: () => ipcRenderer.invoke('seer:getSettings'),
  saveSettings: (
    payload: Partial<AppSettings> & { cloudApiKey?: string; hubSpotToken?: string }
  ) => ipcRenderer.invoke('seer:saveSettings', payload),
  selectDocsFolder: () => ipcRenderer.invoke('seer:selectDocsFolder'),
  selectTicketFile: () => ipcRenderer.invoke('seer:selectTicketFile'),
  testOllama: (baseUrl: string) => ipcRenderer.invoke('seer:testOllama', baseUrl),
  listOpenCodeZenModels: (baseUrl?: string) =>
    ipcRenderer.invoke('seer:listOpenCodeZenModels', baseUrl),
  testDocsRepo: (repoPath: string) => ipcRenderer.invoke('seer:testDocsRepo', repoPath),
  previewPiiScrub: (rawText: string, customerName?: string, agentName?: string) =>
    ipcRenderer.invoke('seer:previewPiiScrub', rawText, customerName, agentName),
  getRuns: () => ipcRenderer.invoke('seer:getRuns'),
  getRunDetails: (runId: string) => ipcRenderer.invoke('seer:getRunDetails', runId),
  inspectDocFile: (relativePath: string) =>
    ipcRenderer.invoke('seer:inspectDocFile', relativePath),
  openDocInExplorer: (relativePath: string) =>
    ipcRenderer.invoke('seer:openDocInExplorer', relativePath),
  getTaxonomy: () => ipcRenderer.invoke('seer:getTaxonomy'),
  saveTaxonomy: (config: TaxonomyAndPromptsConfig) =>
    ipcRenderer.invoke('seer:saveTaxonomy', config),
  resetTaxonomy: () => ipcRenderer.invoke('seer:resetTaxonomy'),
  submitVerdictAudit: (payload: VerdictAuditPayload) =>
    ipcRenderer.invoke('seer:submitVerdictAudit', payload),
  getAccuracyMetrics: (runId?: string) =>
    ipcRenderer.invoke('seer:getAccuracyMetrics', runId),
  getCalibrationExamples: () => ipcRenderer.invoke('seer:getCalibrationExamples'),
  deleteCalibrationExample: (exampleId: string) =>
    ipcRenderer.invoke('seer:deleteCalibrationExample', exampleId),
  runAnalysis: (params: {
    sourceMode: 'csv' | 'hubspot' | 'sample';
    ticketFilePath?: string;
    dateRangeStart: string;
    dateRangeEnd: string;
  }) => ipcRenderer.invoke('seer:runAnalysis', params),
  onAnalysisProgress: (callback: (event: AnalysisProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: AnalysisProgressEvent) =>
      callback(data);
    ipcRenderer.on('seer:analysisProgress', listener);
    return () => {
      ipcRenderer.removeListener('seer:analysisProgress', listener);
    };
  },
});
