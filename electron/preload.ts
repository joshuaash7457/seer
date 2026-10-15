import { contextBridge, ipcRenderer } from 'electron';
import { AnalysisProgressEvent, AppSettings } from '../src/types/seer';

contextBridge.exposeInMainWorld('seerApi', {
  getSettings: () => ipcRenderer.invoke('seer:getSettings'),
  saveSettings: (
    payload: Partial<AppSettings> & { cloudApiKey?: string; hubSpotToken?: string }
  ) => ipcRenderer.invoke('seer:saveSettings', payload),
  selectDocsFolder: () => ipcRenderer.invoke('seer:selectDocsFolder'),
  selectTicketFile: () => ipcRenderer.invoke('seer:selectTicketFile'),
  testOllama: (baseUrl: string) => ipcRenderer.invoke('seer:testOllama', baseUrl),
  testDocsRepo: (repoPath: string) => ipcRenderer.invoke('seer:testDocsRepo', repoPath),
  previewPiiScrub: (rawText: string, customerName?: string, agentName?: string) =>
    ipcRenderer.invoke('seer:previewPiiScrub', rawText, customerName, agentName),
  getRuns: () => ipcRenderer.invoke('seer:getRuns'),
  getRunDetails: (runId: string) => ipcRenderer.invoke('seer:getRunDetails', runId),
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
