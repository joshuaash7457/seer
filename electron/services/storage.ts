import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  AnalysisRunSummary,
  AppSettings,
  GapRecommendation,
  TaxonomyAndPromptsConfig,
  TicketAnalysisVerdict,
} from '../../src/types/seer';

export interface StoredDatabaseState {
  settings: AppSettings;
  runs: AnalysisRunSummary[];
  verdicts: TicketAnalysisVerdict[];
  recommendations: GapRecommendation[];
}

export class SeerStorage {
  private dataDir: string;
  private dbFilePath: string;
  private secretsFilePath: string;
  private taxonomyFilePath: string;
  private defaultTaxonomyPath: string;
  private encryptFn?: (plainText: string) => Buffer;
  private decryptFn?: (cipherBuf: Buffer) => string;

  constructor(options?: {
    dataDir?: string;
    defaultTaxonomyPath?: string;
    encryptFn?: (plainText: string) => Buffer;
    decryptFn?: (cipherBuf: Buffer) => string;
  }) {
    this.dataDir =
      options?.dataDir ||
      path.join(process.env.APPDATA || path.join(os.homedir(), '.seer'), 'Seer');

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.dbFilePath = path.join(this.dataDir, 'seer-store.json');
    this.secretsFilePath = path.join(this.dataDir, 'seer-secrets.bin.json');
    this.taxonomyFilePath = path.join(this.dataDir, 'taxonomy-and-prompts.json');
    this.defaultTaxonomyPath =
      options?.defaultTaxonomyPath ||
      path.resolve(process.cwd(), 'config', 'taxonomy-and-prompts.json');
    this.encryptFn = options?.encryptFn;
    this.decryptFn = options?.decryptFn;

    // Seed editable taxonomy & prompts if not yet in user data folder
    if (!fs.existsSync(this.taxonomyFilePath)) {
      if (fs.existsSync(this.defaultTaxonomyPath)) {
        fs.copyFileSync(this.defaultTaxonomyPath, this.taxonomyFilePath);
      }
    }
  }

  private getDefaultDocsRepoPath(): string {
    const candidate = path.join(os.homedir(), 'online-docs');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    return '';
  }

  private readState(): StoredDatabaseState {
    const defaultSettings: AppSettings = {
      docsRepoPath: this.getDefaultDocsRepoPath(),
      aiProvider: 'ollama',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'llama3.1:8b',
      cloudModel: 'gpt-4o-mini',
      hasCloudApiKey: Boolean(this.getSecret('cloudApiKey')),
      hasHubSpotToken: Boolean(this.getSecret('hubSpotToken')),
      hubSpotPipelineFilter: '',
    };

    if (!fs.existsSync(this.dbFilePath)) {
      return {
        settings: defaultSettings,
        runs: [],
        verdicts: [],
        recommendations: [],
      };
    }

    try {
      const raw = JSON.parse(fs.readFileSync(this.dbFilePath, 'utf-8')) as Partial<StoredDatabaseState>;
      const mergedSettings: AppSettings = {
        ...defaultSettings,
        ...(raw.settings || {}),
        hasCloudApiKey: Boolean(this.getSecret('cloudApiKey')),
        hasHubSpotToken: Boolean(this.getSecret('hubSpotToken')),
      };
      if (!mergedSettings.docsRepoPath && defaultSettings.docsRepoPath) {
        mergedSettings.docsRepoPath = defaultSettings.docsRepoPath;
      }
      return {
        settings: mergedSettings,
        runs: Array.isArray(raw.runs) ? raw.runs : [],
        verdicts: Array.isArray(raw.verdicts) ? raw.verdicts : [],
        recommendations: Array.isArray(raw.recommendations) ? raw.recommendations : [],
      };
    } catch {
      return {
        settings: defaultSettings,
        runs: [],
        verdicts: [],
        recommendations: [],
      };
    }
  }

  private writeState(state: StoredDatabaseState): void {
    const tmpPath = `${this.dbFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.dbFilePath);
  }

  public getSettings(): AppSettings {
    return this.readState().settings;
  }

  public saveSettings(
    partial: Partial<AppSettings> & { cloudApiKey?: string; hubSpotToken?: string }
  ): AppSettings {
    if (partial.cloudApiKey !== undefined) {
      this.setSecret('cloudApiKey', partial.cloudApiKey.trim());
    }
    if (partial.hubSpotToken !== undefined) {
      this.setSecret('hubSpotToken', partial.hubSpotToken.trim());
    }

    const state = this.readState();
    const { cloudApiKey: _c, hubSpotToken: _h, ...cleanPartial } = partial;
    state.settings = {
      ...state.settings,
      ...cleanPartial,
      hasCloudApiKey: Boolean(this.getSecret('cloudApiKey')),
      hasHubSpotToken: Boolean(this.getSecret('hubSpotToken')),
    };
    this.writeState(state);
    return state.settings;
  }

  public setSecret(key: 'cloudApiKey' | 'hubSpotToken', value: string): void {
    let secrets: Record<string, { encrypted: boolean; data: string }> = {};
    if (fs.existsSync(this.secretsFilePath)) {
      try {
        secrets = JSON.parse(fs.readFileSync(this.secretsFilePath, 'utf-8'));
      } catch {
        secrets = {};
      }
    }

    if (!value) {
      delete secrets[key];
    } else if (this.encryptFn) {
      const buf = this.encryptFn(value);
      secrets[key] = { encrypted: true, data: buf.toString('base64') };
    } else {
      secrets[key] = { encrypted: false, data: Buffer.from(value, 'utf-8').toString('base64') };
    }

    fs.writeFileSync(this.secretsFilePath, JSON.stringify(secrets, null, 2), 'utf-8');
  }

  public getSecret(key: 'cloudApiKey' | 'hubSpotToken'): string {
    if (!fs.existsSync(this.secretsFilePath)) return '';
    try {
      const secrets = JSON.parse(fs.readFileSync(this.secretsFilePath, 'utf-8')) as Record<
        string,
        { encrypted: boolean; data: string }
      >;
      const entry = secrets[key];
      if (!entry || !entry.data) return '';
      const buf = Buffer.from(entry.data, 'base64');
      if (entry.encrypted && this.decryptFn) {
        return this.decryptFn(buf);
      }
      return buf.toString('utf-8');
    } catch {
      return '';
    }
  }

  public getTaxonomyAndPrompts(): TaxonomyAndPromptsConfig {
    if (fs.existsSync(this.taxonomyFilePath)) {
      try {
        return JSON.parse(fs.readFileSync(this.taxonomyFilePath, 'utf-8')) as TaxonomyAndPromptsConfig;
      } catch {
        // Fall through
      }
    }
    return JSON.parse(fs.readFileSync(this.defaultTaxonomyPath, 'utf-8')) as TaxonomyAndPromptsConfig;
  }

  public saveTaxonomyAndPrompts(config: TaxonomyAndPromptsConfig): TaxonomyAndPromptsConfig {
    fs.writeFileSync(this.taxonomyFilePath, JSON.stringify(config, null, 2), 'utf-8');
    return config;
  }

  public resetTaxonomyAndPrompts(): TaxonomyAndPromptsConfig {
    const defaults = JSON.parse(
      fs.readFileSync(this.defaultTaxonomyPath, 'utf-8')
    ) as TaxonomyAndPromptsConfig;
    fs.writeFileSync(this.taxonomyFilePath, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }

  public saveRunResult(
    run: AnalysisRunSummary,
    verdicts: TicketAnalysisVerdict[],
    recommendations: GapRecommendation[]
  ): void {
    const state = this.readState();
    state.runs = [run, ...state.runs.filter((r) => r.id !== run.id)];
    state.verdicts = [
      ...verdicts,
      ...state.verdicts.filter((v) => v.runId !== run.id),
    ];
    state.recommendations = [
      ...recommendations,
      ...state.recommendations.filter((rec) => rec.runId !== run.id),
    ];
    this.writeState(state);
  }

  public getRuns(): AnalysisRunSummary[] {
    return this.readState().runs;
  }

  public getRunDetails(runId: string): {
    run: AnalysisRunSummary | null;
    verdicts: TicketAnalysisVerdict[];
    recommendations: GapRecommendation[];
  } {
    const state = this.readState();
    const targetRun =
      runId === 'latest'
        ? state.runs[0] || null
        : state.runs.find((r) => r.id === runId) || null;

    if (!targetRun) {
      return { run: null, verdicts: [], recommendations: [] };
    }

    return {
      run: targetRun,
      verdicts: state.verdicts.filter((v) => v.runId === targetRun.id),
      recommendations: state.recommendations
        .filter((r) => r.runId === targetRun.id)
        .sort((a, b) => b.priorityScore - a.priorityScore),
    };
  }
}
