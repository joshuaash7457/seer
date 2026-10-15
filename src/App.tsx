import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Cpu,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Layers,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  AnalysisProgressEvent,
  AnalysisRunSummary,
  AppSettings,
  FixType,
  GapRecommendation,
  GapVerdictType,
  ScrubResult,
  TicketAnalysisVerdict,
} from './types/seer';

type NavTab = 'dashboard' | 'pii_lab' | 'settings';
type ResultsSubTab = 'recommendations' | 'verdicts';

function formatFixBadge(fixType: FixType) {
  switch (fixType) {
    case 'NEW_ARTICLE':
      return {
        label: 'New Article Needed',
        cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        icon: FileText,
      };
    case 'EDIT_ARTICLE':
      return {
        label: 'Edit Existing Doc',
        cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        icon: BookOpen,
      };
    case 'IMPROVE_FINDABILITY':
      return {
        label: 'Improve Findability / Cross-Link',
        cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
        icon: Search,
      };
    case 'BUILD_TOOL':
      return {
        label: 'Interactive Tool / Wizard',
        cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
        icon: Wrench,
      };
    default:
      return {
        label: 'No Change Needed',
        cls: 'bg-slate-700/40 text-slate-400 border-slate-600/30',
        icon: CheckCircle2,
      };
  }
}

function formatVerdictLabel(verdict: GapVerdictType): string {
  switch (verdict) {
    case 'NO_DOC':
      return 'No Doc Exists';
    case 'PARTIAL_COVERAGE':
      return 'Doc Exists — Missing Key Detail';
    case 'COVERED_FOUND_UNHELPFUL':
      return 'Doc Exists — Unhelpful / Video-Only Stub';
    case 'COVERED_HARD_TO_FIND':
      return 'Doc Exists — Customer Could Not Find It';
    case 'NEEDS_TOOL':
      return 'Prose Insufficient — Needs Interactive Tool';
    case 'WELL_COVERED':
      return 'Well Covered / Non-Doc Ticket';
  }
}

const DEFAULT_PII_SAMPLE = `From: Pastor David Miller <dmiller@calvarychapelav.org>
Hi Support,

We bought a PT-SUPERJOY-G1 (S/N: SJG1998271, MAC: A4:B2:C3:11:22:33) and two Move 4K cameras.
Our camera is stuck on fallback IP 192.168.100.88 while our church LAN is 192.168.1.50 (WAN IP: 74.122.45.199).
Our shipping address is 412 Oakwood Avenue Suite 100. Call me at (484) 555-0142.

Thanks,
David Miller`;

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [resultsSubTab, setResultsSubTab] = useState<ResultsSubTab>('recommendations');

  // Settings state
  const [settings, setSettings] = useState<AppSettings>({
    docsRepoPath: '',
    aiProvider: 'ollama',
    ollamaBaseUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1:8b',
    cloudModel: 'gpt-4o-mini',
    hasCloudApiKey: false,
    hasHubSpotToken: false,
    hubSpotPipelineFilter: '',
  });
  const [cloudApiKeyInput, setCloudApiKeyInput] = useState('');
  const [hubSpotTokenInput, setHubSpotTokenInput] = useState('');
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [docsRepoTestStatus, setDocsRepoTestStatus] = useState<{
    chunkCount: number;
    fileCount: number;
    sampleTitles: string[];
  } | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaTestError, setOllamaTestError] = useState<string | null>(null);

  // Run configuration state
  const [sourceMode, setSourceMode] = useState<'sample' | 'csv' | 'hubspot'>('sample');
  const [ticketFilePath, setTicketFilePath] = useState<string>('');
  const [dateRangeStart, setDateRangeStart] = useState<string>(() => {
    const d = new Date(Date.now() - 14 * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const [dateRangeEnd, setDateRangeEnd] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  // Analysis execution & results state
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgressEvent | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runs, setRuns] = useState<AnalysisRunSummary[]>([]);
  const [currentRun, setCurrentRun] = useState<AnalysisRunSummary | null>(null);
  const [recommendations, setRecommendations] = useState<GapRecommendation[]>([]);
  const [verdicts, setVerdicts] = useState<TicketAnalysisVerdict[]>([]);

  // PII Lab state
  const [piiInputText, setPiiInputText] = useState(DEFAULT_PII_SAMPLE);
  const [piiCustomerName, setPiiCustomerName] = useState('Pastor David Miller');
  const [piiResult, setPiiResult] = useState<ScrubResult | null>(null);

  useEffect(() => {
    if (!window.seerApi) return;

    window.seerApi.getSettings().then((s) => {
      setSettings(s);
      if (s.docsRepoPath) {
        window.seerApi.testDocsRepo(s.docsRepoPath).then((res) => {
          if (res.ok) setDocsRepoTestStatus(res);
        });
      }
    });

    window.seerApi.getRuns().then((loadedRuns) => {
      setRuns(loadedRuns);
      if (loadedRuns.length > 0) {
        window.seerApi.getRunDetails(loadedRuns[0].id).then((details) => {
          setCurrentRun(details.run);
          setRecommendations(details.recommendations);
          setVerdicts(details.verdicts);
        });
      }
    });

    const unsub = window.seerApi.onAnalysisProgress((evt) => {
      setProgress(evt);
    });

    return () => unsub();
  }, []);

  const handleSelectDocsFolder = async () => {
    const chosen = await window.seerApi.selectDocsFolder();
    if (chosen) {
      setSettings((prev) => ({ ...prev, docsRepoPath: chosen }));
      const testRes = await window.seerApi.testDocsRepo(chosen);
      setDocsRepoTestStatus(testRes);
    }
  };

  const handleTestDocsRepo = async () => {
    if (!settings.docsRepoPath) return;
    const testRes = await window.seerApi.testDocsRepo(settings.docsRepoPath);
    setDocsRepoTestStatus(testRes);
  };

  const handleTestOllama = async () => {
    setOllamaTestError(null);
    try {
      const res = await window.seerApi.testOllama(settings.ollamaBaseUrl);
      setOllamaModels(res.models);
      if (res.models.length > 0 && !res.models.includes(settings.ollamaModel)) {
        setSettings((prev) => ({ ...prev, ollamaModel: res.models[0] }));
      }
    } catch (err: unknown) {
      setOllamaTestError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await window.seerApi.saveSettings({
      ...settings,
      cloudApiKey: cloudApiKeyInput ? cloudApiKeyInput : undefined,
      hubSpotToken: hubSpotTokenInput ? hubSpotTokenInput : undefined,
    });
    setSettings(updated);
    setCloudApiKeyInput('');
    setHubSpotTokenInput('');
    setSettingsStatus('Settings & encrypted credentials saved.');
    setTimeout(() => setSettingsStatus(null), 3500);
  };

  const handleSelectTicketFile = async () => {
    const file = await window.seerApi.selectTicketFile();
    if (file) {
      setTicketFilePath(file);
      setSourceMode('csv');
    }
  };

  const handleRunAnalysis = async () => {
    setIsRunning(true);
    setRunError(null);
    setProgress({
      runId: 'starting',
      stage: 'ingesting',
      current: 0,
      total: 1,
      message: 'Ingesting & scrubbing support tickets...',
    });

    try {
      const result = await window.seerApi.runAnalysis({
        sourceMode,
        ticketFilePath: sourceMode === 'csv' ? ticketFilePath : undefined,
        dateRangeStart,
        dateRangeEnd,
      });
      setCurrentRun(result.run);
      setRecommendations(result.recommendations);
      setVerdicts(result.verdicts);
      const updatedRuns = await window.seerApi.getRuns();
      setRuns(updatedRuns);
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const handleSwitchRun = async (runId: string) => {
    const details = await window.seerApi.getRunDetails(runId);
    setCurrentRun(details.run);
    setRecommendations(details.recommendations);
    setVerdicts(details.verdicts);
  };

  const handleRunPiiPreview = async () => {
    const res = await window.seerApi.previewPiiScrub(piiInputText, piiCustomerName);
    setPiiResult(res);
  };

  useEffect(() => {
    if (activeTab === 'pii_lab' && !piiResult && window.seerApi) {
      handleRunPiiPreview();
    }
  }, [activeTab]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500/20 border border-sky-400/40 flex items-center justify-center text-sky-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white">Seer</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 font-medium">
                PTZOptics KB Gap Analyzer
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Where are customers contacting support because our self-service docs didn't help them?
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'dashboard'
                ? 'bg-sky-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            Gap Analysis & Recommendations
          </button>
          <button
            onClick={() => setActiveTab('pii_lab')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'pii_lab'
                ? 'bg-sky-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            PII Scrubber Verifier
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === 'settings'
                ? 'bg-sky-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Settings className="w-4 h-4" />
            Settings & Connections
          </button>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {activeTab === 'dashboard' && (
          <>
            {/* Analysis Launcher Card */}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div className="space-y-3 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                      Run Support Ticket Gap Analysis
                    </h2>
                    {settings.docsRepoPath ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Docs Repo: {settings.docsRepoPath}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                        No Docusaurus repo path set (configure in Settings)
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {/* Ticket Source Selector */}
                    <div className="md:col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">Ticket Data Source</label>
                      <div className="flex gap-2">
                        <select
                          value={sourceMode}
                          onChange={(e) =>
                            setSourceMode(e.target.value as 'sample' | 'csv' | 'hubspot')
                          }
                          className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                        >
                          <option value="sample">
                            PTZOptics Real-World Sample Batch (8 Tickets + Real Local Docs)
                          </option>
                          <option value="csv">HubSpot Ticket CSV / JSON Export File</option>
                          <option value="hubspot">
                            HubSpot Live API {settings.hasHubSpotToken ? '(Token Saved)' : '(Needs Token)'}
                          </option>
                        </select>
                        {sourceMode === 'csv' && (
                          <button
                            type="button"
                            onClick={handleSelectTicketFile}
                            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium flex items-center gap-1.5 shrink-0"
                          >
                            <FileSpreadsheet className="w-4 h-4 text-sky-400" />
                            {ticketFilePath ? 'Change File' : 'Browse CSV/JSON'}
                          </button>
                        )}
                      </div>
                      {sourceMode === 'csv' && ticketFilePath && (
                        <p className="text-xs text-sky-400 mt-1 truncate">
                          Selected: {ticketFilePath}
                        </p>
                      )}
                    </div>

                    {/* Date Range */}
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Start Date</label>
                      <input
                        type="date"
                        value={dateRangeStart}
                        onChange={(e) => setDateRangeStart(e.target.value)}
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">End Date</label>
                      <input
                        type="date"
                        value={dateRangeEnd}
                        onChange={(e) => setDateRangeEnd(e.target.value)}
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {runs.length > 1 && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Previous Runs</label>
                      <select
                        value={currentRun?.id || ''}
                        onChange={(e) => handleSwitchRun(e.target.value)}
                        className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                      >
                        {runs.map((r) => (
                          <option key={r.id} value={r.id}>
                            {new Date(r.startedAt).toLocaleString()} ({r.totalTickets} tickets)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <button
                    onClick={handleRunAnalysis}
                    disabled={isRunning || (sourceMode === 'csv' && !ticketFilePath)}
                    className="px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-sm flex items-center gap-2 shadow-md transition"
                  >
                    {isRunning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current" />
                        Start Analysis
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              {isRunning && progress && (
                <div className="mt-4 pt-4 border-t border-slate-800 space-y-2">
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>{progress.message}</span>
                    <span>
                      {progress.total > 0
                        ? `${Math.round((progress.current / progress.total) * 100)}%`
                        : ''}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-400 transition-all duration-300"
                      style={{
                        width: `${
                          progress.total > 0
                            ? Math.max(8, Math.round((progress.current / progress.total) * 100))
                            : 25
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {runError && (
                <div className="mt-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{runError}</span>
                </div>
              )}
            </section>

            {/* Summary KPI Strip */}
            {currentRun ? (
              <>
                <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <p className="text-xs text-slate-400">Tickets Analyzed (PII Scrubbed)</p>
                    <p className="text-2xl font-bold text-white mt-1">{currentRun.totalTickets}</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Source: {currentRun.sourceLabel}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <p className="text-xs text-slate-400">Self-Serviceable Technical Issues</p>
                    <p className="text-2xl font-bold text-sky-400 mt-1">
                      {currentRun.selfServiceableTickets}{' '}
                      <span className="text-sm font-normal text-slate-400">
                        / {currentRun.totalTickets}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Filtered out {currentRun.totalTickets - currentRun.selfServiceableTickets} RMA / hardware tickets
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <p className="text-xs text-slate-400">Prioritized Doc & Tool Actions</p>
                    <p className="text-2xl font-bold text-emerald-400 mt-1">
                      {recommendations.length}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Covering {currentRun.gapTicketsCount} support tickets
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <p className="text-xs text-slate-400">Analysis Engine</p>
                    <p className="text-sm font-semibold text-slate-200 mt-1.5 truncate">
                      {currentRun.aiProvider.toUpperCase()} — {currentRun.aiModel}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Run at {new Date(currentRun.startedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </section>

                {/* Sub-tabs: Prioritized Recommendations vs Individual Ticket Verdicts */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setResultsSubTab('recommendations')}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                        resultsSubTab === 'recommendations'
                          ? 'bg-slate-800 text-white border border-slate-700'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Prioritized Recommendations ({recommendations.length})
                    </button>
                    <button
                      onClick={() => setResultsSubTab('verdicts')}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                        resultsSubTab === 'verdicts'
                          ? 'bg-slate-800 text-white border border-slate-700'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Individual Ticket Verdicts ({verdicts.length})
                    </button>
                  </div>
                </div>

                {/* Recommendations List */}
                {resultsSubTab === 'recommendations' ? (
                  <div className="space-y-4">
                    {recommendations.map((rec, index) => {
                      const badge = formatFixBadge(rec.fixType);
                      const BadgeIcon = badge.icon;
                      return (
                        <div
                          key={rec.id}
                          className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 space-y-4 hover:border-slate-700 transition"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                  #{index + 1} Priority
                                </span>
                                <span
                                  className={`text-xs font-medium px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${badge.cls}`}
                                >
                                  <BadgeIcon className="w-3.5 h-3.5" />
                                  {badge.label}
                                </span>
                                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                                  {formatVerdictLabel(rec.verdict)}
                                </span>
                                <span className="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
                                  {rec.product}
                                </span>
                              </div>
                              <h3 className="text-base font-semibold text-white">{rec.title}</h3>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="text-right px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
                                <div className="text-xs text-slate-400">Support Volume</div>
                                <div className="text-sm font-bold text-white">
                                  {rec.ticketCount} {rec.ticketCount === 1 ? 'Ticket' : 'Tickets'}
                                </div>
                              </div>
                              <div className="text-right px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
                                <div className="text-xs text-slate-400">Impact Score</div>
                                <div className="text-sm font-bold text-sky-400">
                                  {rec.priorityScore}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
                            <div className="rounded-lg bg-slate-950/70 border border-slate-800/80 p-3.5 space-y-1.5">
                              <div className="text-xs font-semibold uppercase tracking-wider text-rose-300">
                                Why Self-Service Failed
                              </div>
                              <p className="text-slate-300 text-xs leading-relaxed">
                                {rec.whyDocsFailed}
                              </p>
                              {rec.targetDocPath && (
                                <div className="pt-1 text-xs text-slate-400 font-mono">
                                  Target Doc:{' '}
                                  <span className="text-sky-300">{rec.targetDocPath}</span>
                                </div>
                              )}
                            </div>

                            <div className="rounded-lg bg-slate-950/70 border border-slate-800/80 p-3.5 space-y-1.5">
                              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                                Concrete Recommended Action
                              </div>
                              <p className="text-slate-200 text-xs leading-relaxed">
                                {rec.concreteAction}
                              </p>
                            </div>
                          </div>

                          {/* Evidence: Anonymized Customer Questions */}
                          <div className="pt-1">
                            <div className="text-xs font-medium text-slate-400 mb-1.5">
                              Evidence ({rec.ticketIds.join(', ')}) — Anonymized Customer Questions:
                            </div>
                            <ul className="space-y-1">
                              {rec.exampleQuestions.map((q, qIdx) => (
                                <li
                                  key={qIdx}
                                  className="text-xs text-slate-300 bg-slate-950/50 px-3 py-1.5 rounded border border-slate-800/60"
                                >
                                  "{q}"
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Per-Ticket Verdicts Table */
                  <div className="space-y-3">
                    {verdicts.map((v) => {
                      const badge = formatFixBadge(v.fixType);
                      return (
                        <div
                          key={v.id}
                          className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                #{v.externalId}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded bg-sky-500/15 text-sky-300">
                                {v.product}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                {v.category}
                              </span>
                              {!v.isSelfServiceable ? (
                                <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-700 text-slate-300">
                                  Filtered Out: Non-Self-Service (RMA / Hardware)
                                </span>
                              ) : (
                                <span
                                  className={`text-xs px-2.5 py-0.5 rounded-full border ${badge.cls}`}
                                >
                                  {formatVerdictLabel(v.verdict)} → {badge.label}
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-slate-400">
                              Confidence: {Math.round(v.confidence * 100)}%
                            </span>
                          </div>

                          <div className="text-sm font-medium text-white">
                            Q: {v.customerQuestion}
                          </div>
                          <div className="text-xs text-slate-300">
                            <span className="text-slate-400 font-medium">Support Resolution: </span>
                            {v.resolutionSummary}
                          </div>
                          {v.matchedDocPath && (
                            <div className="text-xs font-mono text-sky-300">
                              Matched Doc: {v.matchedDocPath} ({v.matchedDocTitle})
                            </div>
                          )}
                          <div className="text-xs text-slate-400">{v.gapReasoning}</div>

                          <details className="text-xs text-slate-400 pt-1">
                            <summary className="cursor-pointer hover:text-slate-200">
                              View PII-Scrubbed Ticket Excerpt
                            </summary>
                            <pre className="mt-2 p-3 rounded bg-slate-950 border border-slate-800 whitespace-pre-wrap font-mono text-slate-300 text-[11px]">
                              {v.scrubbedSnippet}
                            </pre>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              /* Empty State before first run */
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
                <Sparkles className="w-10 h-10 text-sky-400 mx-auto" />
                <h3 className="text-lg font-semibold text-white">
                  Ready to Run Your First Support Gap Analysis
                </h3>
                <p className="text-sm text-slate-400 max-w-xl mx-auto">
                  Click <strong>Start Analysis</strong> above to index your local{' '}
                  <code>docs.ptzoptics.com</code> Docusaurus repo, scrub customer PII from tickets,
                  and generate prioritized documentation and tool recommendations.
                </p>
              </div>
            )}
          </>
        )}

        {/* PII Scrubber Live Verification Tab */}
        {activeTab === 'pii_lab' && (
          <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  Local PII Scrubber Verification Lab
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Every ticket is scrubbed locally on your machine before touching SQLite or any AI
                  model. Note how private diagnostic camera IPs (like 192.168.100.88) are preserved
                  while names, emails, phones, addresses, MACs, serials, and public WAN IPs are
                  redacted.
                </p>
              </div>
              <button
                onClick={handleRunPiiPreview}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs"
              >
                Test Scrubber Now
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Known Contact Name (from Ticket Metadata)
                  </label>
                  <input
                    type="text"
                    value={piiCustomerName}
                    onChange={(e) => setPiiCustomerName(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Raw Un-Scrubbed Support Email / Ticket
                  </label>
                  <textarea
                    rows={10}
                    value={piiInputText}
                    onChange={(e) => setPiiInputText(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-xs font-mono text-slate-200"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Scrubbed Output (Safe for Storage & AI)</span>
                  {piiResult && (
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      {piiResult.redactionCount} PII Tokens Redacted
                    </span>
                  )}
                </div>
                <pre className="w-full h-[250px] overflow-auto rounded-lg bg-slate-950 border border-emerald-500/30 p-3 text-xs font-mono text-emerald-200 whitespace-pre-wrap">
                  {piiResult?.scrubbedText || ''}
                </pre>
                {piiResult && (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(piiResult.redactionSummary).map(([k, count]) => (
                      <span
                        key={k}
                        className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700"
                      >
                        {k}: <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Settings & Connections Tab */}
        {activeTab === 'settings' && (
          <form
            onSubmit={handleSaveSettings}
            className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 space-y-6 max-w-3xl"
          >
            <div>
              <h2 className="text-base font-semibold text-white">Settings & Connections</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Credentials are encrypted locally via Windows DPAPI (Electron safeStorage) and never
                stored in the git repository.
              </p>
            </div>

            {/* Local Docusaurus Repo */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <label className="block text-sm font-medium text-slate-200">
                1. Local Docusaurus Repository Path (docs.ptzoptics.com)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.docsRepoPath}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, docsRepoPath: e.target.value }))
                  }
                  placeholder="C:\Users\JoshuaAsh\online-docs"
                  className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleSelectDocsFolder}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium flex items-center gap-1.5"
                >
                  <FolderOpen className="w-4 h-4 text-sky-400" />
                  Browse
                </button>
                <button
                  type="button"
                  onClick={handleTestDocsRepo}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium"
                >
                  Test & Index Repo
                </button>
              </div>
              {docsRepoTestStatus && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 space-y-1">
                  <div className="font-semibold">
                    ✓ Indexed {docsRepoTestStatus.fileCount} MDX articles ({docsRepoTestStatus.chunkCount}{' '}
                    searchable sections)
                  </div>
                  <div className="text-slate-400">
                    Sample: {docsRepoTestStatus.sampleTitles.slice(0, 3).join(' • ')}
                  </div>
                </div>
              )}
            </div>

            {/* AI Compute Provider */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <label className="block text-sm font-medium text-slate-200 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-sky-400" />
                2. AI Compute Provider (Local Ollama or Cloud API)
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Provider</label>
                  <select
                    value={settings.aiProvider}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        aiProvider: e.target.value as AppSettings['aiProvider'],
                      }))
                    }
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="ollama">Local / Homelab Ollama (Zero data leaves LAN)</option>
                    <option value="openai">OpenAI API (PII scrubbed before send)</option>
                    <option value="anthropic">Anthropic Claude API (PII scrubbed before send)</option>
                    <option value="gemini">Google Gemini API (PII scrubbed before send)</option>
                  </select>
                </div>

                {settings.aiProvider === 'ollama' ? (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Ollama Server URL</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={settings.ollamaBaseUrl}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, ollamaBaseUrl: e.target.value }))
                        }
                        placeholder="http://localhost:11434"
                        className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={handleTestOllama}
                        className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs"
                      >
                        Fetch Models
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Cloud Model Name</label>
                    <input
                      type="text"
                      value={settings.cloudModel}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, cloudModel: e.target.value }))
                      }
                      placeholder="gpt-4o-mini / claude-3-5-sonnet-latest / gemini-2.0-flash"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                    />
                  </div>
                )}
              </div>

              {settings.aiProvider === 'ollama' ? (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Ollama Model</label>
                  {ollamaModels.length > 0 ? (
                    <select
                      value={settings.ollamaModel}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, ollamaModel: e.target.value }))
                      }
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                    >
                      {ollamaModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={settings.ollamaModel}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, ollamaModel: e.target.value }))
                      }
                      placeholder="llama3.1:8b"
                      className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                    />
                  )}
                  {ollamaTestError && (
                    <p className="text-xs text-amber-400 mt-1">
                      Could not reach Ollama ({ollamaTestError}). Seer will automatically use its
                      local heuristic analyzer until Ollama is online.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Cloud API Key{' '}
                    {settings.hasCloudApiKey && (
                      <span className="text-emerald-400">(Encrypted key stored on machine)</span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={cloudApiKeyInput}
                    onChange={(e) => setCloudApiKeyInput(e.target.value)}
                    placeholder={
                      settings.hasCloudApiKey
                        ? '•••••••••••••••• (Leave blank to keep existing key)'
                        : 'Paste API key...'
                    }
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                  />
                </div>
              )}
            </div>

            {/* HubSpot Connection */}
            <div className="space-y-3 pt-4 border-t border-slate-800">
              <label className="block text-sm font-medium text-slate-200">
                3. HubSpot Private App Token (Optional when using CSV/JSON Export)
              </label>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Private App Access Token{' '}
                  {settings.hasHubSpotToken && (
                    <span className="text-emerald-400">(Encrypted token stored on machine)</span>
                  )}
                </label>
                <input
                  type="password"
                  value={hubSpotTokenInput}
                  onChange={(e) => setHubSpotTokenInput(e.target.value)}
                  placeholder={
                    settings.hasHubSpotToken
                      ? '•••••••••••••••• (Leave blank to keep existing token)'
                      : 'pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
                  }
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center gap-4 pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm"
              >
                Save Settings
              </button>
              {settingsStatus && <span className="text-xs text-emerald-400">{settingsStatus}</span>}
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
