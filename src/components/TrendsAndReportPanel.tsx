import React, { useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  Download,
  FileCode,
  FileText,
  History,
  Minus,
  Rocket,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  AnalysisRunSummary,
  LeadershipReportBundle,
  TrendsComparisonResult,
} from '../types/seer';

interface TrendsAndReportPanelProps {
  runs: AnalysisRunSummary[];
  currentRun: AnalysisRunSummary | null;
  trends: TrendsComparisonResult | null;
  report: LeadershipReportBundle | null;
  onSelectBaselineRun: (previousRunId: string) => void;
  onSeedBaselineRun: () => Promise<void>;
  onDeleteShippedFix: (fixId: string) => Promise<void>;
  onExportReport: (format: 'html' | 'markdown', content: string) => Promise<string | null>;
}

export function TrendsAndReportPanel({
  runs,
  currentRun,
  trends,
  report,
  onSelectBaselineRun,
  onSeedBaselineRun,
  onDeleteShippedFix,
  onExportReport,
}: TrendsAndReportPanelProps) {
  const [previewMode, setPreviewMode] = useState<'markdown' | 'html_preview'>('markdown');
  const [copiedMd, setCopiedMd] = useState(false);
  const [exportToast, setExportToast] = useState<string | null>(null);

  const otherRuns = runs.filter((r) => r.id !== currentRun?.id);

  const handleCopyMarkdown = () => {
    if (!report?.markdown) return;
    navigator.clipboard.writeText(report.markdown);
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 2500);
  };

  const handleSaveReport = async (format: 'html' | 'markdown') => {
    if (!report) return;
    const content = format === 'html' ? report.html : report.markdown;
    const savedPath = await onExportReport(format, content);
    if (savedPath) {
      setExportToast(`Exported ${format.toUpperCase()} report to ${savedPath}`);
      setTimeout(() => setExportToast(null), 4000);
    }
  };

  if (!currentRun || !trends) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center space-y-3">
        <TrendingUp className="w-8 h-8 text-sky-400 mx-auto" />
        <h3 className="text-base font-semibold text-white">No Analysis Run Selected</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Run an analysis first on the <strong>Gap Analysis</strong> tab to view week-over-week
          trends and generate a Leadership Report.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Bar: Baseline Run Selector + Quick Seed Demo Baseline + Export Actions */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-white">
              Run-over-Run Trends & Executive Report Export
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Track rising/falling support clusters, verify whether shipped docs reduced ticket
            volume, and export a zero-PII report for leadership.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {otherRuns.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Compare against:</span>
              <select
                value={trends.previousRun?.id || ''}
                onChange={(e) => onSelectBaselineRun(e.target.value)}
                className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
              >
                {otherRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.sourceLabel} ({r.dateRangeStart} → {r.dateRangeEnd})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSeedBaselineRun}
              className="px-3.5 py-2 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-semibold flex items-center gap-1.5"
            >
              <History className="w-3.5 h-3.5" />
              Load Sample Prior-Week Baseline & Shipped Doc
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5 text-sky-400" />
            {copiedMd ? 'Copied Markdown!' : 'Copy Markdown'}
          </button>

          <button
            type="button"
            onClick={() => handleSaveReport('markdown')}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            Export .MD
          </button>

          <button
            type="button"
            onClick={() => handleSaveReport('html')}
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 shadow"
          >
            <Download className="w-3.5 h-3.5" />
            Export Leadership HTML Report
          </button>
        </div>
      </section>

      {exportToast && (
        <div className="px-4 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{exportToast}</span>
        </div>
      )}

      {/* Section 1: Did Our Shipped Docs & Tools Reduce Tickets? */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Rocket className="w-4 h-4 text-emerald-400" />
              Shipped Documentation & Tool Impact Tracker ({trends.shippedFixImpacts.length})
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Measures whether articles and tools marked as "Shipped" actually reduced support
              tickets in subsequent runs.
            </p>
          </div>
          {otherRuns.length === 0 && trends.shippedFixImpacts.length === 0 && (
            <button
              type="button"
              onClick={onSeedBaselineRun}
              className="text-xs text-sky-400 hover:text-sky-300 underline"
            >
              Seed sample shipped fix to preview impact tracking
            </button>
          )}
        </div>

        {trends.shippedFixImpacts.length === 0 ? (
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-6 text-center text-xs text-slate-400">
            No recommendations marked as shipped yet. Click <strong>"Mark Shipped"</strong> on any
            recommendation card in the Gap Analysis tab after publishing a doc fix, or click{' '}
            <strong>Load Sample Prior-Week Baseline & Shipped Doc</strong> above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                  <th className="py-2.5 px-3">Shipped Doc / Tool</th>
                  <th className="py-2.5 px-3">Product</th>
                  <th className="py-2.5 px-3">Shipped Date</th>
                  <th className="py-2.5 px-3 text-center">Baseline Tickets</th>
                  <th className="py-2.5 px-3 text-center">Current Tickets</th>
                  <th className="py-2.5 px-3">Measured Impact</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {trends.shippedFixImpacts.map((imp) => (
                  <tr key={imp.shippedFix.id} className="hover:bg-slate-950/40">
                    <td className="py-3 px-3">
                      <div className="font-semibold text-white">{imp.shippedFix.title}</div>
                      {imp.shippedFix.targetDocPath && (
                        <div className="font-mono text-[11px] text-sky-400">
                          {imp.shippedFix.targetDocPath}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-300">{imp.shippedFix.product}</td>
                    <td className="py-3 px-3 text-slate-400">
                      {new Date(imp.shippedFix.shippedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-300">
                      {imp.shippedFix.baselineTicketCount}
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-white">
                      {imp.currentTicketCount}
                    </td>
                    <td className="py-3 px-3">
                      {imp.status === 'resolved' && (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                          ✓ 100% Resolved (0 tickets)
                        </span>
                      )}
                      {imp.status === 'improved' && (
                        <span className="px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-semibold">
                          ▼ Reduced ({imp.deltaFromBaseline} tickets / {imp.percentChange}%)
                        </span>
                      )}
                      {imp.status === 'unchanged' && (
                        <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">
                          ➖ Unchanged ({imp.currentTicketCount} tickets)
                        </span>
                      )}
                      {imp.status === 'regressed' && (
                        <span className="px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold">
                          ▲ Increased (+{imp.deltaFromBaseline} tickets)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => onDeleteShippedFix(imp.shippedFix.id)}
                        className="text-slate-500 hover:text-rose-400 p-1"
                        title="Remove from Shipped tracker"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 2: Run-over-Run Issue Cluster Deltas */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">
              Run-over-Run Cluster Trends (
              {trends.previousRun
                ? `Current Run vs. ${trends.previousRun.sourceLabel}`
                : 'First Run — No Prior Baseline Selected'}
              )
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Highlights what is getting worse (rising ticket volume) vs. improving since the prior
              run.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {trends.recommendationDeltas.map((d) => (
            <div
              key={d.recommendationId}
              className="rounded-lg bg-slate-950/80 border border-slate-800 p-3.5 flex items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-sky-500/15 text-sky-300">
                    {d.product}
                  </span>
                  <span className="text-[11px] text-slate-400">{d.fixType}</span>
                </div>
                <div className="text-xs font-semibold text-white truncate">{d.title}</div>
              </div>

              <div className="shrink-0 text-right">
                {d.trendDirection === 'rising' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold">
                    <ArrowUpRight className="w-3.5 h-3.5" />+{d.deltaTicketCount} Rising (
                    {d.previousTicketCount} → {d.currentTicketCount})
                  </span>
                )}
                {d.trendDirection === 'falling' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold">
                    <ArrowDownRight className="w-3.5 h-3.5" />
                    {d.deltaTicketCount} Falling ({d.previousTicketCount} → {d.currentTicketCount})
                  </span>
                )}
                {d.trendDirection === 'stable' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 text-xs">
                    <Minus className="w-3.5 h-3.5" />
                    Stable ({d.currentTicketCount} tickets)
                  </span>
                )}
                {d.trendDirection === 'new' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs font-semibold">
                    <Sparkles className="w-3.5 h-3.5" />
                    New Cluster ({d.currentTicketCount}{' '}
                    {d.currentTicketCount === 1 ? 'ticket' : 'tickets'})
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 3: Live Leadership Report Preview (Markdown & HTML) */}
      {report && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileCode className="w-4 h-4 text-sky-400" />
                Leadership Report Preview (Zero-PII Verified)
              </h3>
              <p className="text-xs text-slate-400">
                Ready to share in a few minutes with PTZOptics support & documentation leadership.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewMode('markdown')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  previewMode === 'markdown'
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                Markdown Report
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('html_preview')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  previewMode === 'html_preview'
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                HTML Executive Preview
              </button>
            </div>
          </div>

          {previewMode === 'markdown' ? (
            <pre className="w-full max-h-[520px] overflow-auto rounded-xl bg-slate-950 border border-slate-800 p-4 text-xs font-mono text-slate-200 whitespace-pre-wrap">
              {report.markdown}
            </pre>
          ) : (
            <iframe
              title="Leadership HTML Report Preview"
              srcDoc={report.html}
              className="w-full h-[540px] rounded-xl border border-slate-800 bg-slate-950"
            />
          )}
        </section>
      )}
    </div>
  );
}
