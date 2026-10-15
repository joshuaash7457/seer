import React, { useEffect, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Edit3,
  ExternalLink,
  FileText,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import {
  AccuracyMetrics,
  CalibrationExample,
  DocFileInspection,
  FixType,
  GapVerdictType,
  TicketAnalysisVerdict,
  VerdictAuditPayload,
} from '../types/seer';

const VERDICT_OPTIONS: Array<{ value: GapVerdictType; label: string }> = [
  { value: 'NO_DOC', label: 'NO_DOC — Missing from docs entirely' },
  { value: 'PARTIAL_COVERAGE', label: 'PARTIAL_COVERAGE — Doc misses key detail/step' },
  { value: 'COVERED_FOUND_UNHELPFUL', label: 'COVERED_FOUND_UNHELPFUL — Confusing or video-only stub' },
  { value: 'COVERED_HARD_TO_FIND', label: 'COVERED_HARD_TO_FIND — Doc exists, customer missed it' },
  { value: 'NEEDS_TOOL', label: 'NEEDS_TOOL — Interactive tool/wizard needed' },
  { value: 'WELL_COVERED', label: 'WELL_COVERED — No doc gap' },
];

const FIX_OPTIONS: Array<{ value: FixType; label: string }> = [
  { value: 'NEW_ARTICLE', label: 'NEW_ARTICLE — Write new article' },
  { value: 'EDIT_ARTICLE', label: 'EDIT_ARTICLE — Edit existing doc' },
  { value: 'IMPROVE_FINDABILITY', label: 'IMPROVE_FINDABILITY — Cross-link / SEO' },
  { value: 'BUILD_TOOL', label: 'BUILD_TOOL — Build interactive tool' },
  { value: 'NONE', label: 'NONE — No change needed' },
];

interface SpotCheckPanelProps {
  verdicts: TicketAnalysisVerdict[];
  metrics: AccuracyMetrics | null;
  calibrationExamples: CalibrationExample[];
  onSubmitAudit: (payload: VerdictAuditPayload) => Promise<void>;
  onDeleteCalibration: (id: string) => Promise<void>;
}

export function SpotCheckPanel({
  verdicts,
  metrics,
  calibrationExamples,
  onSubmitAudit,
  onDeleteCalibration,
}: SpotCheckPanelProps) {
  const [auditFilter, setAuditFilter] = useState<'ALL' | 'UNAUDITED' | 'APPROVED' | 'CORRECTED'>('ALL');
  const [selectedVerdictId, setSelectedVerdictId] = useState<string>('');
  const [docInspection, setDocInspection] = useState<DocFileInspection | null>(null);

  // Override form state
  const [isEditingOverride, setIsEditingOverride] = useState(false);
  const [overrideVerdict, setOverrideVerdict] = useState<GapVerdictType>('PARTIAL_COVERAGE');
  const [overrideFixType, setOverrideFixType] = useState<FixType>('EDIT_ARTICLE');
  const [overrideDocPath, setOverrideDocPath] = useState<string>('');
  const [overrideAction, setOverrideAction] = useState<string>('');
  const [overrideNote, setOverrideNote] = useState<string>('');
  const [statusToast, setStatusToast] = useState<string | null>(null);

  const filteredVerdicts = verdicts.filter((v) => {
    if (auditFilter === 'UNAUDITED') return !v.humanAudit;
    if (auditFilter === 'APPROVED') return v.humanAudit === 'approved';
    if (auditFilter === 'CORRECTED') return v.humanAudit === 'corrected';
    return true;
  });

  const activeVerdict =
    filteredVerdicts.find((v) => v.id === selectedVerdictId) || filteredVerdicts[0] || null;

  useEffect(() => {
    if (activeVerdict && activeVerdict.id !== selectedVerdictId) {
      setSelectedVerdictId(activeVerdict.id);
    }
  }, [activeVerdict?.id]);

  useEffect(() => {
    if (!activeVerdict) {
      setDocInspection(null);
      return;
    }
    setOverrideVerdict(activeVerdict.verdict);
    setOverrideFixType(activeVerdict.fixType);
    setOverrideDocPath(activeVerdict.matchedDocPath || '');
    setOverrideAction(activeVerdict.recommendedAction || '');
    setOverrideNote(activeVerdict.humanCorrectionNote || '');
    setIsEditingOverride(false);

    if (activeVerdict.matchedDocPath && window.seerApi) {
      window.seerApi.inspectDocFile(activeVerdict.matchedDocPath).then(setDocInspection);
    } else {
      setDocInspection(null);
    }
  }, [activeVerdict?.id, activeVerdict?.matchedDocPath]);

  const handleQuickApprove = async () => {
    if (!activeVerdict) return;
    await onSubmitAudit({
      verdictId: activeVerdict.id,
      auditStatus: 'approved',
      humanNote: 'Spot-checked and confirmed accurate.',
    });
    setStatusToast(`Approved verdict for Ticket #${activeVerdict.externalId}.`);
    setTimeout(() => setStatusToast(null), 2500);
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVerdict) return;
    await onSubmitAudit({
      verdictId: activeVerdict.id,
      auditStatus: 'corrected',
      correctedVerdict: overrideVerdict,
      correctedFixType: overrideFixType,
      correctedDocPath: overrideDocPath.trim() || null,
      correctedRecommendedAction: overrideAction.trim(),
      humanNote:
        overrideNote.trim() ||
        `Corrected from ${activeVerdict.originalVerdict || activeVerdict.verdict} to ${overrideVerdict}.`,
    });
    setIsEditingOverride(false);
    setStatusToast(
      `Saved override for #${activeVerdict.externalId} & added to Few-Shot Calibration memory.`
    );
    setTimeout(() => setStatusToast(null), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Accuracy & Trust KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">Measured Trust / Agreement Score</p>
            <Award className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400 mt-1">
            {metrics?.agreementRatePercent !== null && metrics?.agreementRatePercent !== undefined
              ? `${metrics.agreementRatePercent}%`
              : 'Not Yet Audited'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {metrics?.auditedCount || 0} of {metrics?.totalVerdicts || 0} verdicts spot-checked
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-xs text-slate-400">Spot-Check Breakdown</p>
          <p className="text-2xl font-bold text-white mt-1">
            <span className="text-emerald-400">{metrics?.approvedCount || 0}</span> Approved{' '}
            <span className="text-slate-500">/</span>{' '}
            <span className="text-amber-400">{metrics?.correctedCount || 0}</span> Corrected
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Corrections immediately re-cluster recommendations
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-xs text-slate-400">Active Few-Shot Calibration Rules</p>
          <p className="text-2xl font-bold text-sky-400 mt-1">
            {calibrationExamples.length}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Injected into future AI gap analysis runs
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-xs text-slate-400">How Accuracy Calibration Works</p>
          <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
            Spot-check tickets below against the matched Docusaurus MDX file. Every approval or
            override updates Seer's precision score and trains future runs.
          </p>
        </div>
      </section>

      {statusToast && (
        <div className="px-4 py-2.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{statusToast}</span>
        </div>
      )}

      {/* Side-by-Side Spot-Check Workspace */}
      {verdicts.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-sm text-slate-400">
          Run an analysis first on the <strong>Gap Analysis & Evidence</strong> tab to spot-check
          ticket verdicts.
        </div>
      ) : (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Column: Ticket List Selector (3 cols) */}
          <div className="lg:col-span-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 flex flex-col space-y-3 max-h-[680px]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Tickets ({filteredVerdicts.length})
              </h3>
              <select
                value={auditFilter}
                onChange={(e) => setAuditFilter(e.target.value as typeof auditFilter)}
                className="rounded bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-200"
              >
                <option value="ALL">All ({verdicts.length})</option>
                <option value="UNAUDITED">Unaudited</option>
                <option value="APPROVED">Approved</option>
                <option value="CORRECTED">Corrected</option>
              </select>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredVerdicts.map((v) => {
                const isSelected = activeVerdict?.id === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVerdictId(v.id)}
                    className={`w-full text-left p-3 rounded-lg border transition space-y-1 ${
                      isSelected
                        ? 'bg-sky-500/15 border-sky-500/50 text-white'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-sky-400">#{v.externalId}</span>
                      {v.humanAudit === 'approved' && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                          ✓ Approved
                        </span>
                      )}
                      {v.humanAudit === 'corrected' && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                          ✎ Corrected
                        </span>
                      )}
                      {!v.humanAudit && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                          Unaudited
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-medium line-clamp-2">{v.customerQuestion}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {v.verdict} → {v.fixType}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Center Column: Ticket Verdict & One-Click Audit Controls (5 cols) */}
          {activeVerdict && (
            <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-sky-400">
                      Ticket #{activeVerdict.externalId}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {activeVerdict.product}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{activeVerdict.category}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleQuickApprove}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${
                      activeVerdict.humanAudit === 'approved'
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                        : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    Approve Call
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingOverride(!isEditingOverride)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition ${
                      activeVerdict.humanAudit === 'corrected' || isEditingOverride
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Correct / Override
                  </button>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                    Anonymized Customer Question
                  </div>
                  <div className="text-sm font-medium text-white">
                    "{activeVerdict.customerQuestion}"
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                  <div className="text-emerald-400 font-semibold uppercase tracking-wider text-[10px]">
                    How Support Solved It
                  </div>
                  <div className="text-slate-200 leading-relaxed">
                    {activeVerdict.resolutionSummary}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sky-400 font-semibold uppercase tracking-wider text-[10px]">
                      Seer Verdict & Gap Reasoning
                    </span>
                    <span className="text-slate-400">
                      Confidence: {Math.round(activeVerdict.confidence * 100)}%
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-white font-semibold">
                      Verdict: {activeVerdict.verdict}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-semibold">
                      Fix: {activeVerdict.fixType}
                    </span>
                  </div>
                  {activeVerdict.originalVerdict &&
                    activeVerdict.originalVerdict !== activeVerdict.verdict && (
                      <div className="text-amber-300 text-[11px]">
                        (Overridden from original call: {activeVerdict.originalVerdict})
                      </div>
                    )}
                  <p className="text-slate-300 leading-relaxed pt-1">
                    {activeVerdict.gapReasoning}
                  </p>
                  <p className="text-emerald-300 leading-relaxed">
                    <strong>Action:</strong> {activeVerdict.recommendedAction}
                  </p>
                </div>

                {/* Override Editor Form */}
                {isEditingOverride && (
                  <form
                    onSubmit={handleSaveOverride}
                    className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3"
                  >
                    <div className="text-xs font-semibold text-amber-300">
                      Override Verdict & Teach Seer (Few-Shot Calibration)
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        Correct Verdict
                      </label>
                      <select
                        value={overrideVerdict}
                        onChange={(e) => setOverrideVerdict(e.target.value as GapVerdictType)}
                        className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                      >
                        {VERDICT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        Correct Fix Type
                      </label>
                      <select
                        value={overrideFixType}
                        onChange={(e) => setOverrideFixType(e.target.value as FixType)}
                        className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                      >
                        {FIX_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        Target Docusaurus .mdx Path (optional)
                      </label>
                      <input
                        type="text"
                        value={overrideDocPath}
                        onChange={(e) => setOverrideDocPath(e.target.value)}
                        placeholder="docs/knowledge-base/..."
                        className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        Recommended Action
                      </label>
                      <input
                        type="text"
                        value={overrideAction}
                        onChange={(e) => setOverrideAction(e.target.value)}
                        className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-300 mb-1">
                        Why is this the right call? (Saved as Few-Shot Rule)
                      </label>
                      <input
                        type="text"
                        value={overrideNote}
                        onChange={(e) => setOverrideNote(e.target.value)}
                        placeholder="e.g., Doc already covers this under Network Settings section 2."
                        className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingOverride(false)}
                        className="px-3 py-1 rounded bg-slate-800 text-slate-300 text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-3.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs"
                      >
                        Save Override & Re-Cluster
                      </button>
                    </div>
                  </form>
                )}

                <details className="text-xs text-slate-400">
                  <summary className="cursor-pointer hover:text-slate-200">
                    View Full Scrubbed Ticket Text
                  </summary>
                  <pre className="mt-2 p-2.5 rounded bg-slate-950 border border-slate-800 whitespace-pre-wrap font-mono text-[11px] text-slate-300 max-h-40 overflow-y-auto">
                    {activeVerdict.scrubbedSnippet}
                  </pre>
                </details>
              </div>
            </div>
          )}

          {/* Right Column: Matched Docusaurus MDX File Preview (4 cols) */}
          <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 flex flex-col space-y-3 max-h-[680px]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Matched Docusaurus Doc
              </h3>
              {activeVerdict?.matchedDocPath && docInspection?.found && (
                <button
                  onClick={() =>
                    window.seerApi.openDocInExplorer(activeVerdict.matchedDocPath!)
                  }
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Explorer
                </button>
              )}
            </div>

            {activeVerdict?.matchedDocPath && docInspection?.found ? (
              <>
                <div className="text-xs font-mono text-sky-300 bg-slate-950 px-2.5 py-1.5 rounded border border-slate-800 truncate">
                  {activeVerdict.matchedDocPath}
                </div>
                <pre className="flex-1 overflow-y-auto rounded-lg bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-slate-200 whitespace-pre-wrap">
                  {docInspection.expandedText}
                </pre>
              </>
            ) : (
              <div className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-6 flex flex-col items-center justify-center text-center space-y-2">
                <FileText className="w-7 h-7 text-slate-600" />
                <div className="text-xs font-medium text-slate-300">
                  No Matched Doc (NO_DOC / Non-Doc Ticket)
                </div>
                <p className="text-[11px] text-slate-500">
                  If you know a doc exists in <code>online-docs</code> for this issue, click{' '}
                  <strong>Correct / Override</strong> and enter its path.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Active Few-Shot Calibration Examples Table */}
      {calibrationExamples.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Saved Few-Shot Calibration Memory ({calibrationExamples.length})
              </h3>
              <p className="text-xs text-slate-400">
                These human-verified decisions are automatically fed into future AI gap analysis
                prompts.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {calibrationExamples.map((ex) => (
              <div
                key={ex.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
              >
                <div className="space-y-0.5 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                        ex.auditType === 'corrected'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {ex.auditType.toUpperCase()}
                    </span>
                    <span className="font-mono text-slate-400">#{ex.ticketExternalId}</span>
                    <span className="text-sky-300 font-medium">{ex.product}</span>
                    <span className="text-white font-semibold">
                      → {ex.verifiedVerdict} ({ex.verifiedFixType})
                    </span>
                  </div>
                  <div className="text-slate-300">"{ex.customerQuestion}"</div>
                  <div className="text-slate-400 italic">Note: {ex.humanNote}</div>
                </div>
                <button
                  onClick={() => onDeleteCalibration(ex.id)}
                  className="text-slate-500 hover:text-rose-400 p-1"
                  title="Remove calibration rule"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
