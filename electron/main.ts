import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import path from 'path';
import { SeerStorage } from './services/storage';
import { listOllamaModels, listOpenCodeZenModels } from './services/aiProvider';
import { indexDocusaurusRepo, inspectDocFile } from './services/docsIndexer';
import { scrubPII } from './services/piiScrubber';
import {
  fetchHubSpotTickets,
  getSamplePTZOpticsTickets,
  normalizeAndScrubTickets,
  parseTicketFile,
} from './services/ticketIngestor';
import { runFullGapAnalysis } from './services/analysisPipeline';
import { AppSettings, TaxonomyAndPromptsConfig, VerdictAuditPayload } from '../src/types/seer';

let mainWindow: BrowserWindow | null = null;
let storage: SeerStorage;

function initStorage() {
  storage = new SeerStorage({
    dataDir: path.join(app.getPath('userData'), 'SeerData'),
    defaultTaxonomyPath: path.join(app.getAppPath(), 'config', 'taxonomy-and-prompts.json'),
    encryptFn: (plainText: string) =>
      safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(plainText)
        : Buffer.from(plainText, 'utf-8'),
    decryptFn: (cipherBuf: Buffer) =>
      safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(cipherBuf)
        : cipherBuf.toString('utf-8'),
  });
}

function createWindow() {
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#020617',
    title: 'Seer — PTZOptics Support Knowledge Gap Analyzer',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const isDev = !app.isPackaged && process.argv.includes('--dev');

  if (isDev) {
    mainWindow.loadURL(devServerUrl);
  } else {
    const indexHtml = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexHtml).catch(() => {
      mainWindow?.loadURL(devServerUrl);
    });
  }
}

app.whenReady().then(() => {
  initStorage();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpcHandlers() {
  ipcMain.handle('seer:getSettings', async () => {
    return storage.getSettings();
  });

  ipcMain.handle(
    'seer:saveSettings',
    async (
      _event,
      payload: Partial<AppSettings> & { cloudApiKey?: string; hubSpotToken?: string }
    ) => {
      return storage.saveSettings(payload);
    }
  );

  ipcMain.handle('seer:selectDocsFolder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Local Docusaurus Repository Folder (docs.ptzoptics.com)',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('seer:selectTicketFile', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select HubSpot Ticket Export (CSV or JSON)',
      filters: [
        { name: 'Ticket Exports (CSV, JSON)', extensions: ['csv', 'json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('seer:testOllama', async (_event, baseUrl: string) => {
    const models = await listOllamaModels(baseUrl);
    return { ok: true, models };
  });

  ipcMain.handle('seer:listOpenCodeZenModels', async (_event, baseUrl?: string) => {
    const settings = storage.getSettings();
    const apiKey = storage.getSecret('cloudApiKey');
    const models = await listOpenCodeZenModels(
      baseUrl || settings.openCodeZenBaseUrl,
      apiKey
    );
    return { ok: true, models };
  });

  ipcMain.handle('seer:testDocsRepo', async (_event, repoPath: string) => {
    const chunks = indexDocusaurusRepo(repoPath);
    const uniqueFiles = new Set(chunks.map((c) => c.relativePath)).size;
    return {
      ok: chunks.length > 0,
      chunkCount: chunks.length,
      fileCount: uniqueFiles,
      sampleTitles: chunks.slice(0, 5).map((c) => `${c.title} (${c.relativePath})`),
    };
  });

  ipcMain.handle(
    'seer:previewPiiScrub',
    async (_event, rawText: string, customerName?: string, agentName?: string) => {
      return scrubPII(rawText, {
        knownCustomerNames: customerName ? [customerName] : [],
        knownAgentNames: agentName ? [agentName] : [],
      });
    }
  );

  ipcMain.handle('seer:getRuns', async () => {
    return storage.getRuns();
  });

  ipcMain.handle('seer:getRunDetails', async (_event, runId: string) => {
    return storage.getRunDetails(runId);
  });

  ipcMain.handle('seer:inspectDocFile', async (_event, relativePath: string) => {
    const settings = storage.getSettings();
    return inspectDocFile(settings.docsRepoPath, relativePath);
  });

  ipcMain.handle('seer:openDocInExplorer', async (_event, relativePath: string) => {
    const settings = storage.getSettings();
    const info = inspectDocFile(settings.docsRepoPath, relativePath);
    if (info.found && info.absolutePath) {
      shell.showItemInFolder(info.absolutePath);
      return true;
    }
    return false;
  });

  ipcMain.handle('seer:getTaxonomy', async () => {
    return storage.getTaxonomyAndPrompts();
  });

  ipcMain.handle('seer:saveTaxonomy', async (_event, config: TaxonomyAndPromptsConfig) => {
    return storage.saveTaxonomyAndPrompts(config);
  });

  ipcMain.handle('seer:resetTaxonomy', async () => {
    return storage.resetTaxonomyAndPrompts();
  });

  ipcMain.handle('seer:submitVerdictAudit', async (_event, payload: VerdictAuditPayload) => {
    return storage.submitVerdictAudit(payload);
  });

  ipcMain.handle('seer:getAccuracyMetrics', async (_event, runId?: string) => {
    return storage.getAccuracyMetrics(runId);
  });

  ipcMain.handle('seer:getCalibrationExamples', async () => {
    return storage.getCalibrationExamples();
  });

  ipcMain.handle('seer:deleteCalibrationExample', async (_event, exampleId: string) => {
    return storage.deleteCalibrationExample(exampleId);
  });

  ipcMain.handle(
    'seer:runAnalysis',
    async (
      _event,
      params: {
        sourceMode: 'csv' | 'hubspot' | 'sample';
        ticketFilePath?: string;
        dateRangeStart: string;
        dateRangeEnd: string;
      }
    ) => {
      const settings = storage.getSettings();
      const taxonomy = storage.getTaxonomyAndPrompts();

      let tickets;
      let sourceLabel = '';

      if (params.sourceMode === 'hubspot') {
        const token = storage.getSecret('hubSpotToken');
        tickets = await fetchHubSpotTickets({
          accessToken: token,
          dateRangeStart: params.dateRangeStart,
          dateRangeEnd: params.dateRangeEnd,
        });
        sourceLabel = 'HubSpot Live API';
      } else if (params.sourceMode === 'csv' && params.ticketFilePath) {
        tickets = parseTicketFile(
          params.ticketFilePath,
          params.dateRangeStart,
          params.dateRangeEnd
        );
        sourceLabel = path.basename(params.ticketFilePath);
      } else {
        const sampleRaw = getSamplePTZOpticsTickets();
        tickets = normalizeAndScrubTickets(
          sampleRaw,
          params.dateRangeStart,
          params.dateRangeEnd
        );
        sourceLabel = 'PTZOptics Sample Support Batch (8 tickets)';
      }

      if (tickets.length === 0) {
        throw new Error(
          'No tickets matched the selected source and date range. Try widening the start/end dates.'
        );
      }

      const result = await runFullGapAnalysis({
        tickets,
        sourceType: params.sourceMode === 'hubspot' ? 'hubspot' : 'csv',
        sourceLabel,
        dateRangeStart: params.dateRangeStart,
        dateRangeEnd: params.dateRangeEnd,
        docsRepoPath: settings.docsRepoPath,
        taxonomy,
        calibrationExamples: storage.getCalibrationExamples(),
        aiConfig: {
          provider: settings.aiProvider,
          ollamaBaseUrl: settings.ollamaBaseUrl,
          ollamaModel: settings.ollamaModel,
          openCodeZenBaseUrl: settings.openCodeZenBaseUrl,
          openCodeZenModel: settings.openCodeZenModel,
          cloudModel: settings.cloudModel,
          cloudApiKey: storage.getSecret('cloudApiKey'),
        },
        onProgress: (progress) => {
          mainWindow?.webContents.send('seer:analysisProgress', progress);
        },
      });

      storage.saveRunResult(result.run, result.verdicts, result.recommendations);
      return result;
    }
  );
}
