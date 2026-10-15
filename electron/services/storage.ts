import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  AccuracyMetrics,
  AnalysisRunSummary,
  AppSettings,
  CalibrationExample,
  GapRecommendation,
  GapVerdictType,
  LeadershipReportBundle,
  ShippedFixRecord,
  TaxonomyAndPromptsConfig,
  TicketAnalysisVerdict,
  TrendsComparisonResult,
  VerdictAuditPayload,
} from '../../src/types/seer';
import { clusterVerdictsIntoRecommendations } from './analysisPipeline';
import { computeTrendsComparison, generateLeadershipReport } from './trendsAndReports';

export interface StoredDatabaseState {
  settings: AppSettings;
  runs: AnalysisRunSummary[];
  verdicts: TicketAnalysisVerdict[];
  recommendations: GapRecommendation[];
  calibrationExamples: CalibrationExample[];
  shippedFixes: ShippedFixRecord[];
}

const ALL_VERDICT_TYPES: GapVerdictType[] = [
  'NO_DOC',
  'PARTIAL_COVERAGE',
  'COVERED_FOUND_UNHELPFUL',
  'COVERED_HARD_TO_FIND',
  'NEEDS_TOOL',
  'WELL_COVERED',
];

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
    const hasEnvOpenCodeKey = Boolean(process.env.OPENCODE_API_KEY);
    const defaultSettings: AppSettings = {
      docsRepoPath: this.getDefaultDocsRepoPath(),
      aiProvider: 'opencode-zen',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'llama3.1:8b',
      openCodeZenBaseUrl: 'https://opencode.ai/zen/v1',
      openCodeZenModel: 'gpt-5.5',
      cloudModel: 'gpt-5.5',
      hasCloudApiKey: Boolean(this.getSecret('cloudApiKey')) || hasEnvOpenCodeKey,
      hasHubSpotToken: Boolean(this.getSecret('hubSpotToken')),
      hubSpotPipelineFilter: '',
    };

    if (!fs.existsSync(this.dbFilePath)) {
      return {
        settings: defaultSettings,
        runs: [],
        verdicts: [],
        recommendations: [],
        calibrationExamples: [],
        shippedFixes: [],
      };
    }

    try {
      const raw = JSON.parse(
        fs.readFileSync(this.dbFilePath, 'utf-8')
      ) as Partial<StoredDatabaseState>;
      const mergedSettings: AppSettings = {
        ...defaultSettings,
        ...(raw.settings || {}),
        hasCloudApiKey: Boolean(this.getSecret('cloudApiKey')) || hasEnvOpenCodeKey,
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
        calibrationExamples: Array.isArray(raw.calibrationExamples)
          ? raw.calibrationExamples
          : [],
        shippedFixes: Array.isArray(raw.shippedFixes) ? raw.shippedFixes : [],
      };
    } catch {
      return {
        settings: defaultSettings,
        runs: [],
        verdicts: [],
        recommendations: [],
        calibrationExamples: [],
        shippedFixes: [],
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
      hasCloudApiKey:
        Boolean(this.getSecret('cloudApiKey')) || Boolean(process.env.OPENCODE_API_KEY),
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
        return JSON.parse(
          fs.readFileSync(this.taxonomyFilePath, 'utf-8')
        ) as TaxonomyAndPromptsConfig;
      } catch {
        // Fall through
      }
    }
    return JSON.parse(
      fs.readFileSync(this.defaultTaxonomyPath, 'utf-8')
    ) as TaxonomyAndPromptsConfig;
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
    state.verdicts = [...verdicts, ...state.verdicts.filter((v) => v.runId !== run.id)];
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

  public getCalibrationExamples(): CalibrationExample[] {
    return this.readState().calibrationExamples;
  }

  public deleteCalibrationExample(exampleId: string): CalibrationExample[] {
    const state = this.readState();
    state.calibrationExamples = state.calibrationExamples.filter((ex) => ex.id !== exampleId);
    this.writeState(state);
    return state.calibrationExamples;
  }

  public submitVerdictAudit(payload: VerdictAuditPayload): {
    verdict: TicketAnalysisVerdict;
    recommendations: GapRecommendation[];
    metrics: AccuracyMetrics;
    calibrationExamples: CalibrationExample[];
  } {
    const state = this.readState();
    const idx = state.verdicts.findIndex((v) => v.id === payload.verdictId);
    if (idx === -1) {
      throw new Error(`Verdict not found: ${payload.verdictId}`);
    }

    const existing = state.verdicts[idx];
    const originalVerdict = existing.originalVerdict || existing.verdict;
    const originalFixType = existing.originalFixType || existing.fixType;

    const updatedVerdict: TicketAnalysisVerdict = {
      ...existing,
      originalVerdict,
      originalFixType,
      humanAudit: payload.auditStatus,
      humanCorrectionNote: payload.humanNote || null,
      auditedAt: new Date().toISOString(),
      verdict:
        payload.auditStatus === 'corrected' && payload.correctedVerdict
          ? payload.correctedVerdict
          : originalVerdict,
      fixType:
        payload.auditStatus === 'corrected' && payload.correctedFixType
          ? payload.correctedFixType
          : originalFixType,
      matchedDocPath:
        payload.auditStatus === 'corrected' && payload.correctedDocPath !== undefined
          ? payload.correctedDocPath
          : existing.matchedDocPath,
      recommendedAction:
        payload.auditStatus === 'corrected' && payload.correctedRecommendedAction
          ? payload.correctedRecommendedAction
          : existing.recommendedAction,
    };

    state.verdicts[idx] = updatedVerdict;

    // Re-cluster recommendations for this run so human overrides take effect immediately
    const runId = updatedVerdict.runId;
    const runVerdicts = state.verdicts.filter((v) => v.runId === runId);
    const reclustered = clusterVerdictsIntoRecommendations(runId, runVerdicts);
    state.recommendations = [
      ...reclustered,
      ...state.recommendations.filter((r) => r.runId !== runId),
    ];

    const runIdx = state.runs.findIndex((r) => r.id === runId);
    if (runIdx !== -1) {
      state.runs[runIdx] = {
        ...state.runs[runIdx],
        gapTicketsCount: runVerdicts.filter(
          (v) => v.isSelfServiceable && v.verdict !== 'WELL_COVERED'
        ).length,
      };
    }

    // Store / update few-shot calibration example for future runs
    const calId = `cal_${updatedVerdict.externalId}`;
    const calEntry: CalibrationExample = {
      id: calId,
      createdAt: new Date().toISOString(),
      ticketExternalId: updatedVerdict.externalId,
      product: updatedVerdict.product,
      category: updatedVerdict.category,
      customerQuestion: updatedVerdict.customerQuestion,
      matchedDocPath: updatedVerdict.matchedDocPath,
      seerOriginalVerdict: originalVerdict,
      verifiedVerdict: updatedVerdict.verdict,
      verifiedFixType: updatedVerdict.fixType,
      humanNote:
        payload.humanNote ||
        (payload.auditStatus === 'approved'
          ? 'Human spot-check confirmed this verdict is accurate.'
          : `Human corrected verdict from ${originalVerdict} to ${updatedVerdict.verdict}.`),
      auditType: payload.auditStatus,
    };

    state.calibrationExamples = [
      calEntry,
      ...state.calibrationExamples.filter((c) => c.id !== calId),
    ].slice(0, 50);

    this.writeState(state);

    return {
      verdict: updatedVerdict,
      recommendations: reclustered,
      metrics: this.getAccuracyMetrics(runId),
      calibrationExamples: state.calibrationExamples,
    };
  }

  public getAccuracyMetrics(runId?: string): AccuracyMetrics {
    const state = this.readState();
    const targetVerdicts =
      runId && runId !== 'all'
        ? state.verdicts.filter((v) => v.runId === runId)
        : state.verdicts;

    const byVerdict = {} as AccuracyMetrics['byVerdict'];
    for (const vt of ALL_VERDICT_TYPES) {
      byVerdict[vt] = { total: 0, audited: 0, approved: 0, corrected: 0 };
    }

    let auditedCount = 0;
    let approvedCount = 0;
    let correctedCount = 0;

    for (const v of targetVerdicts) {
      const origVt = v.originalVerdict || v.verdict;
      if (!byVerdict[origVt]) {
        byVerdict[origVt] = { total: 0, audited: 0, approved: 0, corrected: 0 };
      }
      byVerdict[origVt].total += 1;

      if (v.humanAudit === 'approved') {
        auditedCount += 1;
        approvedCount += 1;
        byVerdict[origVt].audited += 1;
        byVerdict[origVt].approved += 1;
      } else if (v.humanAudit === 'corrected') {
        auditedCount += 1;
        correctedCount += 1;
        byVerdict[origVt].audited += 1;
        byVerdict[origVt].corrected += 1;
      }
    }

    const agreementRatePercent =
      auditedCount > 0 ? Math.round((approvedCount / auditedCount) * 100) : null;

    return {
      totalVerdicts: targetVerdicts.length,
      auditedCount,
      approvedCount,
      correctedCount,
      agreementRatePercent,
      calibrationExamplesCount: state.calibrationExamples.length,
      byVerdict,
    };
  }

  public getShippedFixes(): ShippedFixRecord[] {
    return this.readState().shippedFixes;
  }

  public markRecommendationShipped(
    recommendationId: string,
    notes?: string
  ): ShippedFixRecord[] {
    const state = this.readState();
    const rec = state.recommendations.find((r) => r.id === recommendationId);
    if (!rec) {
      throw new Error(`Recommendation not found: ${recommendationId}`);
    }

    const fixId = `ship_${rec.targetDocPath || rec.title}`
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_');

    const record: ShippedFixRecord = {
      id: fixId,
      recommendationId: rec.id,
      runIdWhenShipped: rec.runId,
      shippedAt: new Date().toISOString(),
      title: rec.title,
      product: rec.product,
      category: rec.category,
      fixType: rec.fixType,
      targetDocPath: rec.targetDocPath,
      baselineTicketCount: rec.ticketCount,
      notes: notes || 'Shipped to docs.ptzoptics.com',
    };

    state.shippedFixes = [
      record,
      ...state.shippedFixes.filter((s) => s.id !== fixId),
    ];
    this.writeState(state);
    return state.shippedFixes;
  }

  public deleteShippedFix(fixId: string): ShippedFixRecord[] {
    const state = this.readState();
    state.shippedFixes = state.shippedFixes.filter((s) => s.id !== fixId);
    this.writeState(state);
    return state.shippedFixes;
  }

  public getTrendsAndReport(
    currentRunId?: string,
    previousRunId?: string
  ): {
    trends: TrendsComparisonResult;
    report: LeadershipReportBundle | null;
  } {
    const state = this.readState();
    const currentRun =
      currentRunId && currentRunId !== 'latest'
        ? state.runs.find((r) => r.id === currentRunId) || null
        : state.runs[0] || null;

    if (!currentRun) {
      return {
        trends: {
          currentRun: null,
          previousRun: null,
          recommendationDeltas: [],
          resolvedClustersFromPreviousRun: [],
          shippedFixImpacts: [],
        },
        report: null,
      };
    }

    const otherRuns = state.runs.filter((r) => r.id !== currentRun.id);
    const previousRun = previousRunId
      ? otherRuns.find((r) => r.id === previousRunId) || null
      : otherRuns[0] || null;

    const currentRecommendations = state.recommendations
      .filter((r) => r.runId === currentRun.id)
      .sort((a, b) => b.priorityScore - a.priorityScore);

    const previousRecommendations = previousRun
      ? state.recommendations.filter((r) => r.runId === previousRun.id)
      : [];

    const trends = computeTrendsComparison({
      currentRun,
      currentRecommendations,
      previousRun,
      previousRecommendations,
      shippedFixes: state.shippedFixes,
    });

    const accuracy = this.getAccuracyMetrics(currentRun.id);
    const report = generateLeadershipReport({
      run: currentRun,
      recommendations: currentRecommendations,
      trends,
      accuracy,
    });

    return { trends, report };
  }

  /**
   * Seeds a realistic prior-week baseline run + a shipped doc record so you can
   * immediately verify run-over-run rising/falling deltas and Shipped Doc ticket reduction.
   */
  public seedPreviousWeekBaselineRun(): {
    baselineRunId: string;
    shippedFixes: ShippedFixRecord[];
  } {
    const state = this.readState();
    const baselineRunId = 'run_baseline_prior_week';
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

    const baselineRun: AnalysisRunSummary = {
      id: baselineRunId,
      startedAt: sevenDaysAgo,
      completedAt: sevenDaysAgo,
      sourceType: 'csv',
      sourceLabel: 'Prior Week Support Batch (Baseline)',
      dateRangeStart: fourteenDaysAgo.slice(0, 10),
      dateRangeEnd: sevenDaysAgo.slice(0, 10),
      totalTickets: 9,
      selfServiceableTickets: 8,
      gapTicketsCount: 8,
      aiProvider: 'opencode-zen',
      aiModel: 'gpt-5.5',
      status: 'completed',
    };

    const baselineRecommendations: GapRecommendation[] = [
      {
        id: 'rec_base_superjoy',
        runId: baselineRunId,
        title: 'SuperJoy "Configuration Failed" Checklist (Subnet, Port 1259 & ONVIF Credentials)',
        product: 'SuperJoy (PT-SUPERJOY-G1)',
        category: 'Joystick Controller Pairing & Mapping',
        verdict: 'COVERED_FOUND_UNHELPFUL',
        fixType: 'EDIT_ARTICLE',
        ticketCount: 1, // Rose from 1 -> 2 in current week (+1 Rising!)
        priorityScore: 29,
        targetDocPath:
          'docs/knowledge-base/joysticks/superjoy/superjoy-configuration-failed.mdx',
        targetDocTitle: 'Configuration Failed',
        whyDocsFailed: 'Video-only stub without text steps.',
        concreteAction: 'Add text checklist to superjoy-configuration-failed.mdx.',
        exampleQuestions: [
          'Why does SuperJoy say Configuration Failed when adding a camera?',
        ],
        resolutionSummaries: ['Matched subnet and UDP port 1259.'],
        draftMdxOutline: '## SuperJoy Configuration Failed Checklist',
        ticketIds: ['HS-89901'],
      },
      {
        id: 'rec_base_subnet',
        runId: baselineRunId,
        title: 'Interactive Tool: 192.168.100.88 Cross-Subnet Recovery Wizard',
        product: 'Move SE',
        category: 'IP Address Discovery & Subnet Setup',
        verdict: 'NEEDS_TOOL',
        fixType: 'BUILD_TOOL',
        ticketCount: 4, // Dropped from 4 -> 2 in current week (-2 Falling!)
        priorityScore: 119,
        targetDocPath: 'docs/technical-docs/software/gen-3-web-ui/network-settings.mdx',
        targetDocTitle: 'Network Settings',
        whyDocsFailed: 'Users struggle with Windows NIC subnet changes.',
        concreteAction: 'Build 192.168.100.88 recovery wizard.',
        exampleQuestions: ['How do I log into 192.168.100.88 from a 192.168.1.x network?'],
        resolutionSummaries: ['Used temporary secondary IP to switch camera to DHCP.'],
        draftMdxOutline: '## 192.168.100.88 Wizard',
        ticketIds: ['HS-89902', 'HS-89903', 'HS-89904', 'HS-89905'],
      },
      {
        id: 'rec_base_poe_shipped',
        runId: baselineRunId,
        title: 'Move 4K PoE+ (802.3at) vs Standard PoE (802.3af) Reboot Loop Guide',
        product: 'Move 4K',
        category: 'PoE / Power & Network Switch Issues',
        verdict: 'PARTIAL_COVERAGE',
        fixType: 'EDIT_ARTICLE',
        ticketCount: 3, // Dropped from 3 -> 0 after shipping doc!
        priorityScore: 82,
        targetDocPath: 'docs/technical-docs/troubleshooting/cameras.md',
        targetDocTitle: 'Camera Troubleshooting',
        whyDocsFailed: 'Missing 802.3at PoE+ wattage requirement warning when auto-tracking is active.',
        concreteAction: 'Added PoE+ 802.3at (25.5W) requirement callout to Camera Troubleshooting.',
        exampleQuestions: [
          'Why does my Move 4K reboot when panning and zooming on an 802.3af PoE switch?',
        ],
        resolutionSummaries: ['Switched customer from 802.3af (15.4W) port to 802.3at PoE+ (30W) port.'],
        draftMdxOutline: '## PoE+ Power Requirements',
        ticketIds: ['HS-89910', 'HS-89911', 'HS-89912'],
      },
    ];

    // Insert baseline run after current latest run
    const filteredRuns = state.runs.filter((r) => r.id !== baselineRunId);
    state.runs = [...filteredRuns, baselineRun];
    state.recommendations = [
      ...state.recommendations.filter((r) => r.runId !== baselineRunId),
      ...baselineRecommendations,
    ];

    const shippedPoEFix: ShippedFixRecord = {
      id: 'ship_move_4k_poe_plus',
      recommendationId: 'rec_base_poe_shipped',
      runIdWhenShipped: baselineRunId,
      shippedAt: sevenDaysAgo,
      title: 'Move 4K PoE+ (802.3at) vs Standard PoE (802.3af) Reboot Loop Guide',
      product: 'Move 4K',
      category: 'PoE / Power & Network Switch Issues',
      fixType: 'EDIT_ARTICLE',
      targetDocPath: 'docs/technical-docs/troubleshooting/cameras.md',
      baselineTicketCount: 3,
      notes: 'Shipped 802.3at PoE+ callout table last week — reduced tickets from 3 to 0!',
    };

    state.shippedFixes = [
      shippedPoEFix,
      ...state.shippedFixes.filter((s) => s.id !== shippedPoEFix.id),
    ];

    this.writeState(state);
    return {
      baselineRunId,
      shippedFixes: state.shippedFixes,
    };
  }
}
