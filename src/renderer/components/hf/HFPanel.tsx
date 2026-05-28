import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HFAuditEntry,
  HFCachedEntry,
  HFGgufVariant,
  HFModelCard,
  HFSearchHit,
  HFSearchSort,
  HFSettings,
} from '../../../shared/types';

type SubTab = 'browse' | 'cached' | 'research';

/**
 * Curated research-catalog seeds.  v4.0.2 — the user reported the
 * Research tab returned no models even with the search working, so we
 * package a small set of well-known uncensored / abliterated GGUF
 * models as a starting point.  Each entry shows even when the live
 * search has zero hits, giving users something runnable on day one.
 *
 * Selection criteria: GGUF available; sub-12B so they run on consumer
 * hardware; well-known uploaders; either an "uncensored" or "abliterated"
 * lineage so they fit the Research-tab framing.  Sized-tier badge
 * gives the user a quick "will this run on my box" answer.
 */
const RESEARCH_CURATED: Array<{
  repoId: string;
  quant: string;
  paramsLabel: string;
  tier: 'low' | 'mid' | 'high';
  description: string;
}> = [
  // v4.0.2 deep-debug round 2: expanded from 9 to 17 entries based on the
  // empirical survey in scripts/hf-research-survey.mjs.  Repos verified
  // accessible (no auth wall) + present-day download counts captured.
  // Ranked rough-by user-adoption so heavier-hitting models lead.
  // ============================================================================
  // === TOP TIER — highest community usage ===
  {
    repoId: 'bartowski/DeepSeek-R1-Distill-Qwen-32B-abliterated-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '32B',
    tier: 'high',
    description: 'DeepSeek-R1 reasoning distilled into Qwen 32B + abliterated. 131k context. ~40k downloads. Best uncensored reasoner currently available below 70B.',
  },
  {
    repoId: 'bartowski/dolphin-2.9-llama3-8b-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '8B',
    tier: 'mid',
    description: 'Dolphin 2.9 fine-tune of Llama 3 8B. 38k downloads, well-tested. Strong conversational + light coding uncensored model.',
  },
  {
    repoId: 'bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '3B',
    tier: 'low',
    description: 'Llama 3.2 3B uncensored. 29k downloads, 131k context. Smallest serious entry — runs on 4-8 GB GPUs.',
  },
  {
    repoId: 'TheBloke/dolphin-2.5-mixtral-8x7b-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: 'MoE 8x7B',
    tier: 'high',
    description: 'Dolphin 2.5 on Mixtral 8x7B Apache 2.0. 17k downloads. Strong uncensored MoE, 32k context.',
  },
  {
    repoId: 'TheBloke/Wizard-Vicuna-13B-Uncensored-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '13B',
    tier: 'mid',
    description: 'Classic Wizard-Vicuna 13B uncensored. 14k downloads. Llama 2 base, only 2k context but a reference baseline.',
  },
  // === REASONING / CODE ===
  {
    repoId: 'bartowski/Hermes-3-Llama-3.1-8B-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '8B',
    tier: 'mid',
    description: 'Hermes 3 on Llama 3.1 8B. 9k downloads. Neutral-alignment fine-tune from Nous Research — minimal refusals while staying coherent.',
  },
  {
    repoId: 'bartowski/Hermes-3-Llama-3.1-70B-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '70B',
    tier: 'high',
    description: 'Hermes 3 on Llama 3.1 70B. Substantial capability. Needs ~40 GB VRAM at Q4_K_M.',
  },
  {
    repoId: 'mradermacher/DeepSeek-R1-Distill-Llama-70B-abliterated-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '70B',
    tier: 'high',
    description: 'DeepSeek-R1 distilled into Llama 70B + abliterated. 131k context. Largest uncensored reasoner currently available.',
  },
  // === DOLPHIN VARIANTS ===
  {
    repoId: 'cognitivecomputations/dolphin-2.9.4-llama3.1-8b-gguf',
    quant: 'Q4_K_M',
    paramsLabel: '8B',
    tier: 'mid',
    description: 'Official Cognitive Computations Dolphin 2.9.4 on Llama 3.1 8B. 131k context. Latest dolphin — uncensored, strong reasoning + tool use.',
  },
  {
    repoId: 'mradermacher/dolphin-2.9.4-llama3.1-8b-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '8B',
    tier: 'mid',
    description: 'mradermacher i-matrix quant of Dolphin 2.9.4 on Llama 3.1 8B. Better quality per byte than naive Q4 quants.',
  },
  {
    repoId: 'mradermacher/dolphin-2.7-mixtral-8x7b-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: 'MoE 8x7B',
    tier: 'high',
    description: 'Earlier Dolphin 2.7 on Mixtral 8x7B. 32k context. Useful counterpoint to the 2.5 mixtral above.',
  },
  // === ABLITERATED LINEAGE ===
  {
    repoId: 'failspy/Meta-Llama-3-8B-Instruct-abliterated-v3-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '8B',
    tier: 'mid',
    description: 'failspy v3 abliteration of Meta-Llama-3 8B Instruct. The technique that started the abliterated lineage — refusal direction ablated.',
  },
  {
    repoId: 'failspy/Llama-3-70B-Instruct-abliterated-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '70B',
    tier: 'high',
    description: 'failspy abliteration of Llama 3 70B Instruct. Substantial capability without refusals. Needs ~40+ GB VRAM at Q4_K_M.',
  },
  {
    repoId: 'failspy/Phi-3-mini-128k-instruct-abliterated-v3-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '3.8B',
    tier: 'low',
    description: 'Phi-3-mini abliterated — 128k context in a 3.8B package. MIT-licensed. Excellent for low-VRAM experiments and edge devices.',
  },
  {
    repoId: 'mlabonne/NeuralDaredevil-8B-abliterated-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '8B',
    tier: 'mid',
    description: 'mlabonne NeuralDaredevil 8B abliterated. DPO-refined abliteration that recovers some performance lost during refusal ablation.',
  },
  {
    repoId: 'mlabonne/Daredevil-8B-abliterated-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '8B',
    tier: 'mid',
    description: 'mlabonne Daredevil 8B abliterated. Earlier counterpart to NeuralDaredevil — useful comparison baseline.',
  },
  // === LEXI ===
  {
    repoId: 'mradermacher/Llama-3.1-8B-Lexi-Uncensored-V2-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '8B',
    tier: 'mid',
    description: 'Lexi V2 uncensored Llama 3.1 8B. 131k context. Llama 3.1 license. Strong RP + general-purpose uncensored model.',
  },
  // === LEGACY / BASELINE ===
  {
    repoId: 'TheBloke/Wizard-Vicuna-7B-Uncensored-GGUF',
    quant: 'Q4_K_M',
    paramsLabel: '7B',
    tier: 'low',
    description: 'Classic 7B Wizard-Vicuna uncensored. Lower bar to run; useful baseline for comparison against newer models.',
  },
];

const ROLE_FILTERS = [
  { value: '', label: 'Any task' },
  { value: 'text-generation', label: 'Text generation' },
  { value: 'text-classification', label: 'Text classification' },
  { value: 'question-answering', label: 'Question answering' },
  { value: 'summarization', label: 'Summarization' },
  { value: 'translation', label: 'Translation' },
  { value: 'feature-extraction', label: 'Embeddings' },
  { value: 'image-classification', label: 'Image classification' },
  { value: 'automatic-speech-recognition', label: 'Speech to text' },
] as const;

/**
 * HFPanel — Hugging Face Hub browser.
 *
 * Three sub-tabs:
 *   Browse   — live search HF Hub, view model cards, "Import to Ollama"
 *              for GGUF models.
 *   Cached   — local cache directory listing, per-repo size + remove.
 *   Research — uncensored / experimental community catalogs, gated
 *              behind opt-in flag with disclaimer.  Lands in a follow-up PR.
 *
 * Backend lives in main-process HuggingFaceService; renderer talks
 * exclusively through electronAPI.hf.*.
 */
export function HFPanel() {
  const [tab, setTab] = useState<SubTab>('browse');
  const [settings, setSettings] = useState<HFSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await window.electronAPI.hf.getSettings();
        if (!cancelled) setSettings(next);
      } catch (e) {
        if (!cancelled) setErr(formatError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <h3 style={titleStyle}>
        <div style={accentBarStyle} />
        Hugging Face
      </h3>

      {err && (
        <div role="alert" style={errBannerStyle}>{err}</div>
      )}

      <div style={tabStripStyle}>
        <TabButton label="Browse" active={tab === 'browse'} onClick={() => setTab('browse')} />
        <TabButton label="Cached" active={tab === 'cached'} onClick={() => setTab('cached')} />
        <TabButton
          label="Research"
          active={tab === 'research'}
          onClick={() => setTab('research')}
          dimmed={!(settings?.researchModeEnabled)}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'browse' && <BrowseTab onErr={setErr} />}
        {tab === 'cached' && <CachedTab onErr={setErr} />}
        {tab === 'research' && <ResearchTab settings={settings} onSettings={setSettings} />}
      </div>
    </div>
  );
}

// =====================================================================
// Browse
// =====================================================================

function BrowseTab({ onErr }: { onErr: (msg: string | null) => void }) {
  const [query, setQuery] = useState('');
  const [task, setTask] = useState<string>('');
  // v4.0.2: default OFF.  GGUF (GPT-Generated Unified Format) is the
  // quantized weight format llama.cpp / Ollama consume.  Filtering to
  // GGUF only is useful when you know you'll Import to Ollama, but it
  // hides the broader Hub.  Keep it accessible but unchecked by default.
  const [ggufOnly, setGgufOnly] = useState(false);
  const [sort, setSort] = useState<HFSearchSort>('downloads');
  const [results, setResults] = useState<HFSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const inFlight = useRef<number>(0);

  // v4.0.2 deep-debug: the runSearch closure captures `query, task,
  // ggufOnly, sort` at definition time.  Passing an override allows
  // call-sites that set state AND search in one go (e.g. empty-state
  // chips, license filter chips) to use the new values without waiting
  // for React to flush the state update.
  const runSearch = useCallback(async (overrides?: {
    query?: string;
    task?: string;
    ggufOnly?: boolean;
    sort?: HFSearchSort;
  }) => {
    onErr(null);
    setBusy(true);
    const myReq = ++inFlight.current;
    try {
      const hits = await window.electronAPI.hf.search({
        query: (overrides?.query ?? query).trim() || undefined,
        task: (overrides?.task ?? task) || undefined,
        ggufOnly: overrides?.ggufOnly ?? ggufOnly,
        sort: overrides?.sort ?? sort,
        limit: 30,
      });
      if (myReq !== inFlight.current) return; // a newer search superseded us
      setResults(hits);
    } catch (e) {
      onErr(formatError(e));
    } finally {
      if (myReq === inFlight.current) setBusy(false);
    }
  }, [query, task, ggufOnly, sort, onErr]);

  // Auto-run once on mount with the GGUF-only default to give the user
  // something useful immediately instead of an empty page.
  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <input
          type="search"
          placeholder="Search 1M+ models… (e.g. 'llama 3 8b instruct')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch();
          }}
          style={searchInputStyle}
          aria-label="Search Hugging Face models"
        />
        <select
          value={task}
          onChange={(e) => setTask(e.target.value)}
          style={selectStyle}
        >
          {ROLE_FILTERS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as HFSearchSort)}
          style={selectStyle}
          title="Sort search results"
        >
          <option value="downloads">↓ Downloads</option>
          <option value="likes">❤ Likes</option>
          <option value="trending">🔥 Trending</option>
          <option value="modified">🕒 Recently updated</option>
          <option value="created">✨ Recently created</option>
        </select>
        <label
          style={chkStyle}
          title="GGUF = the quantized weight format llama.cpp / Ollama consume. Check this to only see models you can import to Ollama directly."
        >
          <input
            type="checkbox"
            checked={ggufOnly}
            onChange={(e) => setGgufOnly(e.target.checked)}
          />
          <span>GGUF only</span>
        </label>
        <button onClick={() => void runSearch()} disabled={busy} style={primaryBtnStyle}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* v4.0.2 round 7: license quick-filter chips.  Click one to seed the
          query with a license filter; click again to clear.  These map to
          actual HF tag conventions (license:apache-2.0, license:mit, etc.). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>
          License:
        </span>
        {[
          { key: 'apache-2.0', label: 'Apache 2.0' },
          { key: 'mit', label: 'MIT' },
          { key: 'llama3', label: 'Llama 3' },
          { key: 'llama3.1', label: 'Llama 3.1' },
          { key: 'llama3.2', label: 'Llama 3.2' },
          { key: 'gemma', label: 'Gemma' },
          { key: 'cc-by-4.0', label: 'CC-BY' },
        ].map(({ key, label }) => {
          const active = query.includes(`license:${key}`);
          return (
            <button
              key={key}
              title={`Filter to models tagged license:${key}.`}
              onClick={() => {
                let nextQuery: string;
                if (active) {
                  nextQuery = query.replace(new RegExp(`\\s*license:${key}\\b`), '').trim();
                } else {
                  // Replace any other license filter to avoid mutual contradiction.
                  const cleaned = query.replace(/\s*license:[A-Za-z0-9.\-_]+/g, '').trim();
                  nextQuery = (cleaned ? cleaned + ' ' : '') + `license:${key}`;
                }
                setQuery(nextQuery);
                void runSearch({ query: nextQuery });
              }}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 999,
                border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {results.length === 0 && !busy && (
        <div style={emptyStyle}>
          <div>No matches.</div>
          <div style={{ marginTop: 6, fontSize: 11 }}>
            Try one of:{' '}
            {['llama gguf', 'qwen 2.5', 'mistral 7b', 'phi 3', 'embedding', 'code llama'].map((q, i) => (
              <button
                key={q}
                onClick={() => {
                  setQuery(q);
                  // Pass the new query inline; otherwise the closure
                  // captures the old (empty) query and we search for
                  // nothing.
                  void runSearch({ query: q });
                }}
                style={{
                  border: '1px solid var(--border)',
                  background: 'var(--bg-secondary)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  marginLeft: i === 0 ? 0 : 4,
                  marginTop: 4,
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                }}
              >
                {q}
              </button>
            ))}
          </div>
          {ggufOnly && (
            <div style={{ marginTop: 8, fontSize: 11 }}>
              Or{' '}
              <button
                onClick={() => {
                  setGgufOnly(false);
                  void runSearch({ ggufOnly: false });
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--accent-light)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                  fontSize: 11,
                }}
              >
                clear the GGUF Only filter
              </button>
              .
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map((hit) => (
          <ResultCard
            key={hit.id}
            hit={hit}
            expanded={openCardId === hit.id}
            onToggleExpand={() => setOpenCardId((cur) => (cur === hit.id ? null : hit.id))}
            onErr={onErr}
            onSearchBy={(newQuery) => {
              setQuery(newQuery);
              void runSearch({ query: newQuery });
            }}
          />
        ))}
      </div>
    </>
  );
}

function ResultCard({
  hit,
  expanded,
  onToggleExpand,
  onErr,
  researchMode,
  onSearchBy,
}: {
  hit: HFSearchHit;
  expanded: boolean;
  onToggleExpand: () => void;
  onErr: (msg: string | null) => void;
  researchMode?: boolean;
  /** Called when the user clicks a clickable chip (tag / author /
   *  pipelineTag) on the card — rebroadcasts the new query up to
   *  BrowseTab so it can rerun the search. */
  onSearchBy?: (newQuery: string) => void;
}) {
  const [card, setCard] = useState<HFModelCard | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!expanded || card) return;
    let cancelled = false;
    void (async () => {
      setBusy(true);
      try {
        const c = await window.electronAPI.hf.modelInfo(hit.id);
        if (!cancelled) setCard(c);
      } catch (e) {
        if (!cancelled) onErr(formatError(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, card, hit.id, onErr]);

  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* v4.0.2: clicking the title TOGGLES the in-app details panel
              instead of opening the web — the user wanted the details
              flow to stay inside the app.  The separate "Web ↗" button
              on the right is the explicit opt-in for "show me on
              huggingface.co". */}
          <div
            style={{ ...cardTitleStyle, cursor: 'pointer' }}
            onClick={onToggleExpand}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggleExpand();
              }
            }}
            title={expanded ? 'Hide details' : 'Show details'}
          >
            {hit.id}
            {hit.gated && <span style={badgeWarnStyle}>gated</span>}
          </div>
          <div style={cardMetaStyle}>
            {hit.author && (
              <button
                onClick={() => onSearchBy?.(hit.author)}
                title={`Search for other models by ${hit.author}.`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: onSearchBy ? 'pointer' : 'default',
                  color: 'inherit',
                  padding: 0,
                  fontSize: 'inherit',
                  textDecoration: 'underline dotted',
                }}
              >
                @{hit.author}
              </button>
            )}
            {hit.pipelineTag && (
              <button
                onClick={() => onSearchBy?.(hit.pipelineTag!)}
                title={`Search for models with task "${hit.pipelineTag}".`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: onSearchBy ? 'pointer' : 'default',
                  color: 'inherit',
                  padding: 0,
                  fontSize: 'inherit',
                  textDecoration: 'underline dotted',
                }}
              >
                {hit.pipelineTag}
              </button>
            )}
            <span>↓ {formatCount(hit.downloads)}</span>
            <span>♥ {formatCount(hit.likes)}</span>
            {hit.libraryName && <span>📚 {hit.libraryName}</span>}
            {hit.ggufMeta?.architecture && <span>🏛 {hit.ggufMeta.architecture}</span>}
            {hit.ggufMeta?.contextLength && (
              <span>📏 {formatCount(hit.ggufMeta.contextLength)} ctx</span>
            )}
            {hit.ggufMeta?.totalFileSize && (
              <span>💾 {fmtBytes(hit.ggufMeta.totalFileSize)}</span>
            )}
            {hit.updatedAt && <span>{shortDate(hit.updatedAt)}</span>}
          </div>
          {hit.tags.length > 0 && (
            <div style={tagRowStyle}>
              {hit.tags.slice(0, 6).map((t) => (
                <button
                  key={t}
                  onClick={() => onSearchBy?.(t)}
                  title={`Search for models tagged "${t}".`}
                  style={{
                    ...tagChipStyle,
                    border: 'none',
                    cursor: onSearchBy ? 'pointer' : 'default',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={onToggleExpand} style={btnStyle}>
            {expanded ? 'Hide details' : 'Details'}
          </button>
          <button
            onClick={() => {
              void window.electronAPI.models.openExternal(`https://huggingface.co/${hit.id}`).catch(() => undefined);
            }}
            style={btnStyle}
            title="Open this model's page on huggingface.co"
          >
            Web ↗
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {busy && <div style={subtleStyle}>Loading model card…</div>}
          {card && (
            <>
              {card.description && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
                  {card.description.slice(0, 400)}{card.description.length > 400 ? '…' : ''}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {card.license && (
                  <span>
                    License:{' '}
                    {card.licenseLink ? (
                      <a
                        href={card.licenseLink}
                        onClick={(e) => {
                          e.preventDefault();
                          void window.electronAPI.models.openExternal(card.licenseLink!).catch(() => undefined);
                        }}
                        style={{ color: 'var(--accent-light)' }}
                      >
                        <strong>{card.license}</strong> ↗
                      </a>
                    ) : (
                      <strong style={{ color: 'var(--text-secondary)' }}>{card.license}</strong>
                    )}
                  </span>
                )}
                {card.libraryName && <span>Library: <strong>{card.libraryName}</strong></span>}
                {card.ggufMeta?.architecture && (
                  <span>Arch: <strong>{card.ggufMeta.architecture}</strong></span>
                )}
                {card.ggufMeta?.contextLength && (
                  <span>Context: <strong>{formatCount(card.ggufMeta.contextLength)}</strong></span>
                )}
                {card.ggufMeta?.totalFileSize && (
                  <span>Total size: <strong>{fmtBytes(card.ggufMeta.totalFileSize)}</strong></span>
                )}
              </div>
              <GgufVariantList
                repoId={card.id}
                variants={card.gguf}
                onErr={onErr}
                researchMode={researchMode}
              />
              {card.ggufMeta?.chatTemplate && (
                <ChatTemplateViewer
                  chatTemplate={card.ggufMeta.chatTemplate}
                  bosToken={card.ggufMeta.bosToken}
                  eosToken={card.ggufMeta.eosToken}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GgufVariantList({
  repoId,
  variants,
  onErr,
  researchMode,
}: {
  repoId: string;
  variants: HFGgufVariant[];
  onErr: (msg: string | null) => void;
  researchMode?: boolean;
}) {
  // Fetch hardware profile once to mark which variants will fit.  Cached
  // per HFPanel session; the hardware detection IPC itself is throttled.
  const [hwMaxVramGB, setHwMaxVramGB] = useState<number | null>(null);
  const [hwRamGB, setHwRamGB] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void window.electronAPI.hardware.detect().then((hw) => {
      if (!alive) return;
      setHwMaxVramGB(hw.maxVramGB ?? null);
      setHwRamGB(hw.ramGB ?? null);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  // Per-variant launch state.  `null` means idle; "launching" while
  // the IPC is in flight; "launched" for 4s after success so the
  // user sees confirmation.
  const [launchState, setLaunchState] = useState<Record<string, 'launching' | 'launched' | null>>({});
  const launchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Per-fileName direct-download state, keyed by GGUF file name.
  const [downloadState, setDownloadState] = useState<
    Record<string, { percent: number | null; bytesCompleted: number; bytesTotal: number | null; bytesPerSec: number | null; etaSeconds: number | null; done: boolean; error: string | null }>
  >({});

  useEffect(() => () => {
    for (const t of Object.values(launchTimers.current)) clearTimeout(t);
  }, []);

  // Subscribe to download-progress broadcasts and update per-file state.
  useEffect(() => {
    const unsub = window.electronAPI.hf.onDownloadProgress((ev) => {
      if (ev.repoId !== repoId) return;
      setDownloadState((s) => ({
        ...s,
        [ev.fileName]: {
          percent: ev.percent,
          bytesCompleted: ev.bytesCompleted,
          bytesTotal: ev.bytesTotal,
          bytesPerSec: ev.bytesPerSec ?? null,
          etaSeconds: ev.etaSeconds ?? null,
          done: ev.done,
          error: ev.error,
        },
      }));
    });
    return unsub;
  }, [repoId]);

  if (variants.length === 0) {
    return <div style={subtleStyle}>No GGUF files in this repo.</div>;
  }

  const handleCopy = (quant: string | null) => {
    const cmd = `ollama run hf.co/${repoId}${quant ? `:${quant}` : ''}`;
    void window.electronAPI.app.clipboardWrite(cmd).then((ok) => {
      if (!ok) onErr(`Could not copy command. It was: ${cmd}`);
    });
  };

  const handleImport = async (quant: string | null) => {
    const key = quant ?? '__default__';
    setLaunchState((s) => ({ ...s, [key]: 'launching' }));
    try {
      const cwd = await window.electronAPI.git.getCwd().catch(() => undefined);
      const r = await window.electronAPI.hf.importAndLaunch(
        repoId,
        quant,
        cwd ?? undefined,
        !!researchMode
      );
      if (!r.ok) {
        onErr(`Import failed: ${r.error ?? 'unknown error'}`);
        setLaunchState((s) => ({ ...s, [key]: null }));
        return;
      }
      setLaunchState((s) => ({ ...s, [key]: 'launched' }));
      if (launchTimers.current[key]) clearTimeout(launchTimers.current[key]);
      launchTimers.current[key] = setTimeout(() => {
        setLaunchState((s) => ({ ...s, [key]: null }));
      }, 4000);
    } catch (e) {
      onErr(formatError(e));
      setLaunchState((s) => ({ ...s, [key]: null }));
    }
  };

  const handleDownload = async (fileName: string) => {
    setDownloadState((s) => ({
      ...s,
      [fileName]: { percent: 0, bytesCompleted: 0, bytesTotal: null, bytesPerSec: null, etaSeconds: null, done: false, error: null },
    }));
    try {
      const r = await window.electronAPI.hf.download(repoId, fileName);
      if (!r.ok && r.error !== 'cancelled') {
        onErr(`Download failed: ${r.error ?? 'unknown error'}`);
      }
    } catch (e) {
      onErr(formatError(e));
    }
  };

  const handleCancelDownload = (fileName: string) => {
    void window.electronAPI.hf.cancelDownload(repoId, fileName).catch(() => undefined);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
        GGUF variants ({variants.length})
      </div>
      {/* Sort variants: recommended (hardware-aware) first, then by size ascending */}
      {(() => null)()}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(() => sortVariantsForUx(variants, hwMaxVramGB))().slice(0, 12).map((v) => {
          const key = v.quant ?? '__default__';
          const state = launchState[key];
          const dl = downloadState[v.fileName];
          const downloading = !!dl && !dl.done && !dl.error;
          const recommendedFile = pickRecommendedVariant(variants, hwMaxVramGB)?.fileName;
          const isRecommended = recommendedFile === v.fileName;
          const qualityHint = qualityHintFor(v.quant);
          return (
            <div
              key={v.fileName}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '6px 8px',
                background: isRecommended ? 'rgba(139, 92, 246, 0.06)' : 'var(--bg-secondary)',
                border: isRecommended ? '1px solid var(--border-active)' : '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontFamily: 'monospace', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.fileName}
                </span>
                {isRecommended && (
                  <span
                    style={{ ...tagChipStyle, background: 'var(--accent-gradient)', color: '#fff' }}
                    title={
                      hwMaxVramGB
                        ? `Largest quant that fits comfortably on your ${hwMaxVramGB.toFixed(1)} GB GPU. Picked automatically for you.`
                        : 'Recommended balance of size + quality (community default).'
                    }
                  >
                    ★ rec
                  </span>
                )}
                {v.quant && (
                  <span style={tagChipStyle} title={qualityHint}>
                    {v.quant}
                  </span>
                )}
                {v.sizeBytes !== null && (
                  <span style={subtleStyle} title={`Approx VRAM at full context: ${fmtBytes(estimateVramBytes(v.sizeBytes))}`}>
                    {fmtBytes(v.sizeBytes)}
                  </span>
                )}
                {v.sizeBytes !== null && (hwMaxVramGB || hwRamGB) && (
                  <FitBadge
                    sizeBytes={v.sizeBytes}
                    maxVramGB={hwMaxVramGB}
                    ramGB={hwRamGB}
                  />
                )}
                <button
                  onClick={() => void handleImport(v.quant)}
                  disabled={state === 'launching'}
                  style={state === 'launched' ? { ...smallBtnStyle, color: '#22c55e', borderColor: '#22c55e' } : smallBtnStyle}
                  title="Adds this variant to the Models catalog and starts it via Ollama (Ollama pulls the file under its own management)"
                >
                  {state === 'launching' ? 'Launching…' : state === 'launched' ? '✓ Launched' : '▶ Run via Ollama'}
                </button>
                <button
                  onClick={() => void handleDownload(v.fileName)}
                  disabled={downloading}
                  style={dl?.done ? { ...smallBtnStyle, color: '#22c55e', borderColor: '#22c55e' } : smallBtnStyle}
                  title="Stream the GGUF file directly to Catalyst's HF cache (bypasses Ollama)"
                >
                  {downloading
                    ? `${dl.percent ?? 0}%`
                    : dl?.done
                      ? '✓ Saved'
                      : dl?.error
                        ? '⚠ Retry'
                        : '⬇ Download'}
                </button>
                <button
                  onClick={() => handleCopy(v.quant)}
                  style={smallBtnStyle}
                  title="Copy the ollama run command to clipboard"
                >
                  Copy cmd
                </button>
              </div>
              {dl && !dl.done && !dl.error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${dl.percent ?? 0}%`,
                        height: '100%',
                        background: 'var(--accent-gradient, #8b5cf6)',
                        transition: 'width 200ms ease',
                      }}
                    />
                  </div>
                  <span style={{ ...subtleStyle, fontSize: 10 }}>
                    {fmtBytes(dl.bytesCompleted)}
                    {dl.bytesTotal ? ` / ${fmtBytes(dl.bytesTotal)}` : ''}
                    {dl.bytesPerSec ? ` · ${fmtBytes(dl.bytesPerSec)}/s` : ''}
                    {dl.etaSeconds != null ? ` · ${fmtDuration(dl.etaSeconds)} left` : ''}
                  </span>
                  <button
                    onClick={() => handleCancelDownload(v.fileName)}
                    title="Cancel this download. The partial file is discarded."
                    style={{
                      ...smallBtnStyle,
                      padding: '2px 6px',
                      fontSize: 10,
                      color: '#fda4af',
                      borderColor: '#fda4af',
                    }}
                  >
                    ✕ cancel
                  </button>
                </div>
              )}
              {dl?.error && (
                <div style={{ fontSize: 10, color: '#fda4af' }}>{dl.error}</div>
              )}
            </div>
          );
        })}
      </div>
      {Object.values(launchState).some((s) => s === 'launched') && (
        <div style={{ ...subtleStyle, marginTop: 6, color: 'var(--accent-light)' }}>
          Launched — switch to the Models panel to view the running tab.
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Cached
// =====================================================================

function CachedTab({ onErr }: { onErr: (msg: string | null) => void }) {
  const [entries, setEntries] = useState<HFCachedEntry[] | null>(null);
  const [cachePath, setCachePath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [list, p] = await Promise.all([
        window.electronAPI.hf.listCached(),
        window.electronAPI.hf.getCachePath(),
      ]);
      setEntries(list);
      setCachePath(p);
    } catch (e) {
      onErr(formatError(e));
    } finally {
      setBusy(false);
    }
  }, [onErr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (id: string) => {
    if (!confirm(`Delete cached files for ${id}?  Re-download to use again.`)) return;
    try {
      await window.electronAPI.hf.removeCached(id);
      await refresh();
    } catch (e) {
      onErr(formatError(e));
    }
  };

  if (entries === null) {
    return <div style={subtleStyle}>{busy ? 'Loading cache…' : 'No data yet.'}</div>;
  }
  const totalBytes = entries.reduce((s, e) => s + e.sizeBytes, 0);
  return (
    <>
      <div style={{ padding: '8px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          Catalyst&apos;s direct-download cache
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Files you saved via the ⬇ Download button live here.  This is{' '}
          <strong>separate from Ollama&apos;s cache</strong> — "Run via Ollama"
          imports manage their files under <code>OLLAMA_MODELS</code> (typically{' '}
          <code>%LOCALAPPDATA%\Ollama</code> on Windows).
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
          Path: <code style={{ color: 'var(--text-secondary)' }}>{cachePath ?? '?'}</code>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Total: <strong style={{ color: 'var(--text-primary)' }}>{fmtBytes(totalBytes)}</strong>
          {entries.length > 0 && <span> across {entries.length} repo{entries.length === 1 ? '' : 's'}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => void refresh()} disabled={busy} style={btnStyle}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
        {cachePath && (
          <button
            onClick={() => {
              void window.electronAPI.models.openExternal(`file:///${cachePath.replace(/\\/g, '/')}`).catch(() => undefined);
            }}
            style={btnStyle}
            title="Open the cache directory in the OS file explorer"
          >
            Open folder ↗
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <div style={{ ...emptyStyle, marginTop: 10 }}>
          <div>No models in Catalyst&apos;s cache yet.</div>
          <div style={{ marginTop: 6, fontSize: 11 }}>
            Use <strong>⬇ Download</strong> on any GGUF variant to save it here.
            <br />
            For Ollama-managed downloads, use <strong>▶ Run via Ollama</strong> — those go to Ollama&apos;s separate cache.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {entries.map((e) => {
            const repoCachePath = cachePath ? `${cachePath.replace(/[\\/]+$/, '')}/${e.dirName}` : null;
            return (
              <div key={e.id} style={cachedRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{e.id}</div>
                  <div style={subtleStyle}>{fmtBytes(e.sizeBytes)}</div>
                </div>
                {repoCachePath && (
                  <button
                    onClick={() => {
                      void window.electronAPI.models
                        .openExternal(`file:///${repoCachePath.replace(/\\/g, '/')}`)
                        .catch(() => undefined);
                    }}
                    style={btnStyle}
                    title="Open this repo's cache folder in the OS file explorer."
                  >
                    Open ↗
                  </button>
                )}
                {repoCachePath && (
                  <button
                    onClick={() => {
                      void window.electronAPI.app.clipboardWrite(repoCachePath);
                    }}
                    style={btnStyle}
                    title="Copy the cache directory path to clipboard."
                  >
                    Copy path
                  </button>
                )}
                <button
                  onClick={() => void remove(e.id)}
                  style={btnStyle}
                  title="Delete this repo's cached files. Re-download to use again."
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// =====================================================================
// Research (placeholder — fully wired in PR #57)
// =====================================================================

function ResearchTab({
  settings,
  onSettings,
}: {
  settings: HFSettings | null;
  onSettings: (s: HFSettings) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const enabled = !!settings?.researchModeEnabled;
  const enable = async () => {
    setErr(null);
    try {
      const next = await window.electronAPI.hf.setSettings({ researchModeEnabled: true });
      onSettings(next);
    } catch (e) {
      setErr(formatError(e));
    }
  };
  const disable = async () => {
    setErr(null);
    try {
      const next = await window.electronAPI.hf.setSettings({ researchModeEnabled: false });
      onSettings(next);
    } catch (e) {
      setErr(formatError(e));
    }
  };
  if (!enabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={disclaimerStyle}>
          <strong style={{ color: 'var(--text-primary)' }}>Research catalogs are disabled.</strong>
          <p style={{ marginTop: 6 }}>
            These surface community-curated lists of models — including uncensored / experimental
            checkpoints — that may generate harmful content.  Models in this section are not
            reviewed by Hugging Face or by this app.  Use only in sandboxed environments.  You
            assume all responsibility for use.
          </p>
        </div>
        <button onClick={() => void enable()} style={primaryBtnStyle}>
          I understand — enable Research catalogs
        </button>
        {err && <div role="alert" style={errBannerStyle}>{err}</div>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={researchActiveBannerStyle} role="note">
        <div>
          <strong style={{ color: '#fbbf24' }}>Research mode is active.</strong>
          <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>
            Imports get a "Research" badge in Models and every launch is logged below.
          </span>
        </div>
        <button onClick={() => void disable()} style={btnStyle}>
          Disable
        </button>
      </div>
      {err && <div role="alert" style={errBannerStyle}>{err}</div>}
      <CuratedResearchList onErr={setErr} />
      <ResearchBrowse onErr={setErr} />
      <ResearchAuditLog onErr={setErr} />
    </div>
  );
}

function CuratedResearchList({ onErr }: { onErr: (msg: string | null) => void }) {
  const [launchState, setLaunchState] = useState<Record<string, 'launching' | 'launched' | null>>({});
  const launchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => {
    for (const t of Object.values(launchTimers.current)) clearTimeout(t);
  }, []);

  const handleImport = async (repoId: string, quant: string) => {
    const key = `${repoId}:${quant}`;
    setLaunchState((s) => ({ ...s, [key]: 'launching' }));
    try {
      const cwd = await window.electronAPI.git.getCwd().catch(() => undefined);
      const r = await window.electronAPI.hf.importAndLaunch(repoId, quant, cwd ?? undefined, true);
      if (!r.ok) {
        onErr(`Import failed: ${r.error ?? 'unknown error'}`);
        setLaunchState((s) => ({ ...s, [key]: null }));
        return;
      }
      setLaunchState((s) => ({ ...s, [key]: 'launched' }));
      if (launchTimers.current[key]) clearTimeout(launchTimers.current[key]);
      launchTimers.current[key] = setTimeout(() => {
        setLaunchState((s) => ({ ...s, [key]: null }));
      }, 4000);
    } catch (e) {
      onErr(formatError(e));
      setLaunchState((s) => ({ ...s, [key]: null }));
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
        Recommended research models <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({RESEARCH_CURATED.length} curated)</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
        Well-known uncensored / abliterated GGUF models — packaged so the tab has something runnable on day one.
        Each one imports through Ollama just like a regular HF Browse import.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {RESEARCH_CURATED.map((m) => {
          const key = `${m.repoId}:${m.quant}`;
          const state = launchState[key];
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '8px 10px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 4,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {m.repoId}
                  <span style={tagChipStyle}>{m.paramsLabel}</span>
                  <span style={tagChipStyle}>{m.quant}</span>
                  <span style={{ ...tagChipStyle, background: tierColor(m.tier) }}>{m.tier}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                  {m.description}
                </div>
              </div>
              <button
                onClick={() => void handleImport(m.repoId, m.quant)}
                disabled={state === 'launching'}
                style={state === 'launched' ? { ...smallBtnStyle, color: '#22c55e', borderColor: '#22c55e' } : smallBtnStyle}
                title="Adds to Models with a Research badge and starts via Ollama"
              >
                {state === 'launching' ? 'Launching…' : state === 'launched' ? '✓ Launched' : 'Import'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tierColor(tier: 'low' | 'mid' | 'high'): string {
  switch (tier) {
    case 'low': return 'rgba(34, 197, 94, 0.15)';
    case 'mid': return 'rgba(59, 130, 246, 0.15)';
    case 'high': return 'rgba(168, 85, 247, 0.15)';
  }
}

function ResearchBrowse({ onErr }: { onErr: (msg: string | null) => void }) {
  // Same surface as BrowseTab but seeded with a research-leaning query
  // ("uncensored" + "abliterated") and the import button calls
  // hf.importAndLaunch with research:true.
  const [query, setQuery] = useState('uncensored');
  const [results, setResults] = useState<HFSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const inFlight = useRef<number>(0);

  const runSearch = useCallback(async () => {
    onErr(null);
    setBusy(true);
    const myReq = ++inFlight.current;
    try {
      const hits = await window.electronAPI.hf.search({
        query: query.trim() || 'uncensored',
        ggufOnly: true,
        limit: 30,
      });
      if (myReq !== inFlight.current) return;
      setResults(hits);
    } catch (e) {
      onErr(formatError(e));
    } finally {
      if (myReq === inFlight.current) setBusy(false);
    }
  }, [query, onErr]);

  useEffect(() => {
    void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          type="search"
          placeholder="Try 'uncensored', 'abliterated', 'dolphin', 'wizard-vicuna-uncensored'…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch();
          }}
          style={searchInputStyle}
          aria-label="Search Research catalog"
        />
        <button onClick={() => void runSearch()} disabled={busy} style={primaryBtnStyle}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>

      {results.length === 0 && !busy && (
        <div style={emptyStyle}>
          No matches.  Try a different keyword like "abliterated" or a specific repo name.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map((hit) => (
          <ResultCard
            key={hit.id}
            hit={hit}
            expanded={openCardId === hit.id}
            onToggleExpand={() => setOpenCardId((cur) => (cur === hit.id ? null : hit.id))}
            onErr={onErr}
            researchMode
            onSearchBy={(q) => {
              setQuery(q);
              void runSearch();
            }}
          />
        ))}
      </div>
    </>
  );
}

function ResearchAuditLog({ onErr }: { onErr: (msg: string | null) => void }) {
  const [entries, setEntries] = useState<HFAuditEntry[] | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const log = await window.electronAPI.hf.getResearchLog();
      setEntries(log);
    } catch (e) {
      onErr(formatError(e));
    }
  }, [onErr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = async () => {
    if (!confirm('Clear the research audit log?  This cannot be undone.')) return;
    try {
      await window.electronAPI.hf.clearResearchLog();
      await refresh();
    } catch (e) {
      onErr(formatError(e));
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setCollapsed((v) => !v)} style={{ ...btnStyle, padding: '4px 6px' }}>
          {collapsed ? '▶' : '▼'}
        </button>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
          Research audit log
        </span>
        <span style={subtleStyle}>{entries?.length ?? 0} entries</span>
        {entries && entries.length > 0 && (
          <button onClick={() => void clear()} style={btnStyle}>
            Clear
          </button>
        )}
      </div>
      {!collapsed && (
        <div style={{ marginTop: 8 }}>
          {!entries || entries.length === 0 ? (
            <div style={subtleStyle}>No research launches recorded yet.</div>
          ) : (
            <div style={{ maxHeight: 200, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace' }}>
              {entries
                .slice()
                .reverse()
                .map((e, i) => (
                  <div key={`${e.ts}-${i}`} style={{ padding: '3px 0', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{e.ts.slice(0, 19).replace('T', ' ')}</span>
                    {' '}
                    {e.repoId}
                    {e.quant && <span style={{ color: 'var(--accent-light)' }}> :{e.quant}</span>}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Subcomponents + styles
// =====================================================================

function TabButton({
  label,
  active,
  onClick,
  dimmed,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dimmed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        color: active ? 'var(--accent-light, var(--text-primary))' : dimmed ? 'var(--text-muted)' : 'var(--text-secondary)',
        fontSize: 12,
        padding: '8px 12px',
        cursor: 'pointer',
        borderBottom: active ? '2px solid var(--accent, #8b5cf6)' : '2px solid transparent',
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}

/**
 * v4.0.2 deep-debug: hardware fit indicator.  Compares the GGUF file
 * size against the user's max GPU VRAM (and RAM fallback) and renders
 * a coloured badge so the user can scan for what runs on their box at
 * a glance.
 *
 *   green  — fits comfortably (file size * 1.25 <= maxVram)
 *   yellow — tight (file size <= maxVram but headroom < 25%)
 *   orange — CPU only (file size <= ramGB but won't fit on GPU)
 *   red    — won't fit anywhere
 */
function FitBadge({
  sizeBytes,
  maxVramGB,
  ramGB,
}: {
  sizeBytes: number;
  maxVramGB: number | null;
  ramGB: number | null;
}) {
  const fileGB = sizeBytes / 1e9;
  const vram = maxVramGB ?? 0;
  const ram = ramGB ?? 0;
  let tier: 'green' | 'yellow' | 'orange' | 'red';
  let label: string;
  let tip: string;
  if (vram >= fileGB * 1.25) {
    tier = 'green';
    label = '✓ fits GPU';
    tip = `Your ${vram.toFixed(1)} GB GPU has comfortable headroom for this ${fileGB.toFixed(1)} GB file.`;
  } else if (vram >= fileGB) {
    tier = 'yellow';
    label = '~ tight';
    tip = `Your ${vram.toFixed(1)} GB GPU just barely holds this ${fileGB.toFixed(1)} GB file — context cache may not fit.`;
  } else if (ram >= fileGB * 1.5) {
    tier = 'orange';
    label = '◆ CPU only';
    tip = `Won't fit on your ${vram.toFixed(1)} GB GPU, but your ${ram.toFixed(1)} GB RAM can run it on CPU (slow).`;
  } else {
    tier = 'red';
    label = '✗ no fit';
    tip = `${fileGB.toFixed(1)} GB exceeds both your ${vram.toFixed(1)} GB GPU and your ${ram.toFixed(1)} GB RAM.`;
  }
  const colorMap = {
    green: { bg: 'rgba(34, 197, 94, 0.15)', fg: '#22c55e' },
    yellow: { bg: 'rgba(234, 179, 8, 0.15)', fg: '#fbbf24' },
    orange: { bg: 'rgba(249, 115, 22, 0.15)', fg: '#f97316' },
    red: { bg: 'rgba(239, 68, 68, 0.15)', fg: '#ef4444' },
  };
  return (
    <span
      title={tip}
      style={{
        ...tagChipStyle,
        background: colorMap[tier].bg,
        color: colorMap[tier].fg,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

/**
 * v4.0.2 deep-debug: pick the recommended variant given user hardware.
 *
 * Goal: surface the LARGEST quant that fits comfortably in their VRAM,
 * since for most users "biggest model I can run" is the right choice.
 * Comfort margin = 1.25x file size (leaves room for KV cache).
 *
 * Fallbacks when hardware is unknown:
 *   - prefer Q4_K_M (the community default)
 *   - then Q5_K_M
 *   - then any non-Q2 / non-IQ1
 *   - then the first variant in size order
 */
function pickRecommendedVariant(
  variants: HFGgufVariant[],
  maxVramGB: number | null,
): HFGgufVariant | null {
  if (variants.length === 0) return null;
  // Hardware-aware path: largest variant whose 1.25x file size fits in
  // VRAM.  Iterate from biggest down.
  if (maxVramGB && maxVramGB > 0) {
    const vramBytes = maxVramGB * 1e9;
    const sorted = [...variants]
      .filter((v) => v.sizeBytes != null)
      .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
    for (const v of sorted) {
      if ((v.sizeBytes ?? 0) * 1.25 <= vramBytes) return v;
    }
    // Nothing fits comfortably — recommend the smallest as the
    // "least bad" pick on this hardware.
    const smallest = [...variants].sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))[0];
    if (smallest) return smallest;
  }
  // Hardware-unknown path: community defaults.
  return (
    variants.find((v) => v.quant === 'Q4_K_M') ||
    variants.find((v) => v.quant === 'Q5_K_M') ||
    variants.find((v) => v.quant && !/^Q2|^IQ1/i.test(v.quant)) ||
    variants[0] ||
    null
  );
}

/**
 * Sort variants for display: recommended first (per pickRecommendedVariant),
 * then by ascending file size so smaller options follow.
 */
function sortVariantsForUx(
  variants: HFGgufVariant[],
  maxVramGB: number | null,
): HFGgufVariant[] {
  const rec = pickRecommendedVariant(variants, maxVramGB);
  const others = variants
    .filter((v) => v !== rec)
    .sort((a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0));
  return rec ? [rec, ...others] : others;
}

/** One-line tooltip for each quant level. */
function qualityHintFor(quant: string | null): string {
  if (!quant) return '';
  const q = quant.toUpperCase();
  if (q.startsWith('Q2')) return 'Q2 — smallest, lowest quality. Save for absolute size limits.';
  if (q.startsWith('Q3')) return 'Q3 — small, noticeable quality drop.';
  if (q.startsWith('Q4_0')) return 'Q4_0 — legacy 4-bit quant; prefer Q4_K_M.';
  if (q === 'Q4_K_M') return 'Q4_K_M — recommended. Best size/quality trade-off.';
  if (q === 'Q4_K_S') return 'Q4_K_S — smaller than Q4_K_M with minor quality loss.';
  if (q === 'Q5_K_M') return 'Q5_K_M — higher quality, larger than Q4_K_M.';
  if (q === 'Q5_K_S') return 'Q5_K_S — smaller Q5 variant.';
  if (q === 'Q6_K') return 'Q6_K — near-lossless, larger.';
  if (q === 'Q8_0') return 'Q8_0 — nearly identical to full precision; large.';
  if (q === 'F16' || q === 'BF16') return 'F16 — full half-precision. Huge file.';
  if (q === 'F32') return 'F32 — full single-precision. Massive file.';
  if (q.startsWith('IQ')) return 'IQ — i-quant, better quality per byte than legacy Q.';
  return quant;
}

/** Very rough VRAM estimate: GGUF file size + ~25% KV cache overhead.
 *  Real usage varies by context length; this is the "ballpark" for the
 *  hover tooltip on the size badge. */
function estimateVramBytes(fileSize: number): number {
  return Math.round(fileSize * 1.25);
}

/**
 * v4.0.2 round 10: a collapsible viewer for the GGUF chat template +
 * BOS/EOS tokens.  Lets the user inspect the exact Jinja template the
 * model expects without leaving the app.
 */
function ChatTemplateViewer({
  chatTemplate,
  bosToken,
  eosToken,
}: {
  chatTemplate: string;
  bosToken: string | null;
  eosToken: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 6 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Show the Jinja chat template baked into the GGUF. Tells you what message format the model expects."
        style={{
          width: '100%',
          padding: '6px 10px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-primary)',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ width: 12, display: 'inline-block' }}>{open ? '▼' : '▶'}</span>
        Prompt format (chat template)
      </button>
      {open && (
        <div style={{ padding: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 6, fontSize: 10, color: 'var(--text-secondary)' }}>
            {bosToken && (
              <span>
                BOS: <code style={{ color: 'var(--accent-light)' }}>{bosToken}</code>
              </span>
            )}
            {eosToken && (
              <span>
                EOS: <code style={{ color: 'var(--accent-light)' }}>{eosToken}</code>
              </span>
            )}
          </div>
          <pre
            style={{
              fontFamily: 'ui-monospace, Consolas, monospace',
              fontSize: 10,
              color: 'var(--text-secondary)',
              background: 'var(--bg-primary)',
              padding: 8,
              borderRadius: 4,
              maxHeight: 240,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
            }}
          >
            {chatTemplate}
          </pre>
          <button
            onClick={() => {
              void window.electronAPI.app.clipboardWrite(chatTemplate);
            }}
            style={{ ...smallBtnStyle, marginTop: 6 }}
            title="Copy the chat template to the clipboard."
          >
            Copy template
          </button>
        </div>
      )}
    </div>
  );
}

/** "1h 23m" / "3m 42s" / "12s" — short-form duration. */
function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '?';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Unknown error';
}

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
};

const accentBarStyle: React.CSSProperties = {
  width: 3,
  height: 14,
  borderRadius: 2,
  background: 'var(--accent-gradient, #8b5cf6)',
};

const tabStripStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid var(--border)',
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 260,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  fontSize: 12,
  padding: '8px 12px',
  borderRadius: 6,
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  fontSize: 12,
  padding: '6px 8px',
  borderRadius: 4,
};

const chkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: 'var(--text-secondary)',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--accent-gradient, #8b5cf6)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 11,
  cursor: 'pointer',
};

const smallBtnStyle: React.CSSProperties = {
  ...btnStyle,
  padding: '3px 6px',
  fontSize: 10,
};

const cardStyle: React.CSSProperties = {
  padding: 10,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg-primary)',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const cardMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-muted)',
  display: 'flex',
  gap: 8,
  marginTop: 2,
  flexWrap: 'wrap',
};

const tagRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 4,
};

const tagChipStyle: React.CSSProperties = {
  fontSize: 9,
  padding: '2px 6px',
  borderRadius: 999,
  background: 'rgba(139, 92, 246, 0.08)',
  color: 'var(--accent-light, #a78bfa)',
};

const badgeWarnStyle: React.CSSProperties = {
  fontSize: 9,
  padding: '1px 5px',
  borderRadius: 4,
  background: 'rgba(234, 179, 8, 0.15)',
  color: '#fbbf24',
  border: '1px solid rgba(234, 179, 8, 0.3)',
};

const cachedRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
};

const emptyStyle: React.CSSProperties = {
  padding: '14px',
  background: 'var(--bg-primary)',
  border: '1px dashed var(--border)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--text-muted)',
  textAlign: 'center',
};

const errBannerStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: 'rgba(244,63,94,0.08)',
  border: '1px solid rgba(244,63,94,0.3)',
  borderRadius: 6,
  color: '#fda4af',
  fontSize: 11,
};

const subtleStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  lineHeight: 1.5,
};

const disclaimerStyle: React.CSSProperties = {
  padding: '12px',
  background: 'rgba(234, 179, 8, 0.06)',
  border: '1px solid rgba(234, 179, 8, 0.3)',
  borderRadius: 6,
  color: 'var(--text-secondary)',
  fontSize: 11,
  lineHeight: 1.5,
};

const researchActiveBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  background: 'rgba(234, 179, 8, 0.06)',
  border: '1px solid rgba(234, 179, 8, 0.4)',
  borderRadius: 6,
  fontSize: 11,
  lineHeight: 1.5,
};
