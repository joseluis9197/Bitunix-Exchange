// Create Bot Wizard — 4-step modal flow per design doc §7.3.
//
// Steps: Pair → Range → Config → Confirm
//
// Step 4 calls /bots/validate to compute the live preview, then on Confirm
// calls POST /bots which creates the bot in 'paused' state. The user is
// then navigated to the new bot's detail page where they can review the
// grid and explicitly Start it.
//
// Why paused-by-default: the engine's startBot() places real orders on
// GRVT. We don't want a misclick on "Create" to immediately spend money.

import { useState, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Modal } from './primitives/modal';
import { Button } from './primitives/button';
import { Input } from './primitives/input';
import { Mono } from './primitives/mono';
import { api } from '@/lib/api-client';
import { RangePickerChart } from './charts/range-picker-chart';
import {
  formatPercent,
  formatPnl,
  formatSize,
  formatUsd,
} from '@/lib/format';
import type { ValidateBotInput, ValidateBotResult } from '@/lib/api-types';
import { cn } from '@/lib/cn';

interface CreateBotWizardProps {
  open: boolean;
  onClose: () => void;
}

interface WizardState {
  pair: string;
  direction: 'long' | 'short';
  lower: string; // strings while user types
  upper: string;
  grids: string;
  investment: string;
  leverage: string;
  acceptedRisk: boolean;
  compoundPct: string;
  safeguardEnabled: boolean;
  safeguardThresholdPct: string;
  safeguardAction: 'pause' | 'pause_close';
  slPct: string;
  tpPct: string;
  autoShiftEnabled: boolean;
  autoShiftPct: string;
  virtualEnabled: boolean;
  activeWindowSize: string;
}

const INITIAL_STATE: WizardState = {
  pair: '',
  direction: 'long',
  lower: '',
  upper: '',
  grids: '',
  investment: '',
  leverage: '',
  acceptedRisk: false,
  compoundPct: '0',
  safeguardEnabled: false,
  safeguardThresholdPct: '10',
  safeguardAction: 'pause',
  slPct: '',
  tpPct: '',
  autoShiftEnabled: false,
  autoShiftPct: '10',
  virtualEnabled: false,
  activeWindowSize: '70',
};

// H.1: hardcoded fallback — used while the API query is loading
const FALLBACK_PAIRS = [
  { value: 'ETH_USDT_Perp', label: 'ETH-USDT-Perp' },
  { value: 'BTC_USDT_Perp', label: 'BTC-USDT-Perp' },
];

type Step = 0 | 1 | 2 | 3;
const STEP_LABELS = ['Pair', 'Range', 'Config', 'Confirm'];

export function CreateBotWizard({ open, onClose }: CreateBotWizardProps) {
  const [step, setStep] = useState<Step>(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [validated, setValidated] = useState<ValidateBotResult | null>(null);
  const navigate = useNavigate();

  // H.1: fetch available instruments from GRVT API
  const instrumentsQuery = useQuery({
    queryKey: ['instruments'],
    queryFn: () => api.getInstruments(),
    staleTime: 60_000,
    enabled: open,
  });
  const PAIRS = instrumentsQuery.data?.instruments
    ? (instrumentsQuery.data.instruments as any[])
        .filter((i: any) => i.instrument?.includes('_Perp') || i.symbol?.includes('_Perp'))
        .map((i: any) => {
          const name = i.instrument ?? i.symbol ?? i.name;
          return { value: name, label: name.replace(/_/g, '-') };
        })
    : FALLBACK_PAIRS;
  const queryClient = useQueryClient();

  const validateMutation = useMutation({
    mutationFn: (input: ValidateBotInput) => api.validateBot(input),
    onSuccess: (result) => {
      setValidated(result);
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: ValidateBotInput) => api.createBot(input),
    onSuccess: (result) => {
      toast.success(`Bot ${result.id} created (paused). Review and Start when ready.`);
      // Refresh the bots list so the new card appears immediately on Overview.
      void queryClient.invalidateQueries({ queryKey: ['bots'] });
      // Navigate to the new bot's detail page so the user can review +
      // explicitly press Start.
      navigate(`/bots/${result.id}`);
      handleClose();
    },
    onError: (err: Error) => {
      toast.error(`Bot creation failed: ${err.message}`);
    },
  });

  // Reset on close
  function handleClose() {
    setStep(0);
    setState(INITIAL_STATE);
    setValidated(null);
    validateMutation.reset();
    createMutation.reset();
    onClose();
  }

  function handleCreate() {
    if (!validated) return;
    const compoundPct = Math.min(100, Math.max(0, parseInt(state.compoundPct || '0', 10)));
    const safeguardPayload = state.safeguardEnabled
      ? {
          safeguard_enabled: true,
          safeguard_threshold_pct: Math.min(
            50,
            Math.max(1, parseFloat(state.safeguardThresholdPct || '10'))
          ),
          safeguard_action: state.safeguardAction,
        }
      : {};
    // H.3: SL/TP
    const slPct = parseFloat(state.slPct || '0');
    const tpPct = parseFloat(state.tpPct || '0');
    // H.2: auto-shift
    const autoShiftPayload = state.autoShiftEnabled
      ? { auto_shift_enabled: true, auto_shift_pct: parseFloat(state.autoShiftPct || '10') }
      : {};
    // H.8: virtual grids
    const virtualPayload = state.virtualEnabled
      ? {
          virtual_enabled: true,
          active_window_size: Math.min(80, Math.max(20, parseInt(state.activeWindowSize || '70', 10))),
        }
      : {};
    createMutation.mutate({
      pair: validated.pair,
      direction: validated.direction,
      lower_price: validated.input.lower,
      upper_price: validated.input.upper,
      num_grids: validated.input.grids,
      investment_usdt: validated.input.investment,
      leverage: validated.input.leverage,
      ...(compoundPct > 0 ? { compound_pct: compoundPct } : {}),
      ...safeguardPayload,
      ...(slPct > 0 ? { sl_pct: slPct } : {}),
      ...(tpPct > 0 ? { tp_pct: tpPct } : {}),
      ...autoShiftPayload,
      ...virtualPayload,
    } as any);
  }

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
    // Only invalidate the cached /validate result when a CONFIG field
    // changes — ticking the risk checkbox on step 4 must NOT reset
    // validated, otherwise StepConfirm re-renders to null (line 469)
    // and the checkbox disappears mid-tick, breaking the wizard.
    if (
      key !== 'acceptedRisk' &&
      key !== 'compoundPct' &&
      key !== 'safeguardEnabled' &&
      key !== 'safeguardThresholdPct' &&
      key !== 'safeguardAction' &&
      key !== 'slPct' &&
      key !== 'tpPct' &&
      key !== 'autoShiftEnabled' &&
      key !== 'autoShiftPct'
    ) {
      setValidated(null);
    }
  }

  // Trigger validate when entering Step 3 (Confirm).
  function next() {
    if (step === 2) {
      const input: ValidateBotInput = {
        pair: state.pair,
        direction: state.direction,
        lower_price: parseFloat(state.lower),
        upper_price: parseFloat(state.upper),
        num_grids: parseInt(state.grids, 10),
        investment_usdt: parseFloat(state.investment),
        leverage: parseInt(state.leverage, 10),
        ...(state.virtualEnabled
          ? {
              virtual_enabled: true,
              active_window_size: parseInt(state.activeWindowSize || '70', 10),
            }
          : {}),
      } as ValidateBotInput;
      validateMutation.mutate(input);
    }
    setStep((s) => Math.min(3, s + 1) as Step);
  }

  function back() {
    setStep((s) => Math.max(0, s - 1) as Step);
  }

  const canNext = (() => {
    if (step === 0) return !!state.pair;
    if (step === 1) {
      const lo = parseFloat(state.lower);
      const hi = parseFloat(state.upper);
      return Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > lo;
    }
    if (step === 2) {
      const inv = parseFloat(state.investment);
      const grids = parseInt(state.grids, 10);
      const lev = parseInt(state.leverage, 10);
      const maxGrids = state.virtualEnabled ? 500 : 95;
      const windowOk =
        !state.virtualEnabled ||
        (() => {
          const w = parseInt(state.activeWindowSize || '0', 10);
          return w >= 20 && w <= 80;
        })();
      return inv > 0 && grids >= 2 && grids <= maxGrids && lev >= 1 && lev <= 50 && windowOk;
    }
    if (step === 3) return state.acceptedRisk;
    return false;
  })();

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="wide"
      title="Create a new bot"
      description={`Step ${step + 1} of 4 — ${STEP_LABELS[step]}`}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          {step > 0 && (
            <Button variant="secondary" onClick={back}>
              <ChevronLeft className="size-4" />
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button onClick={next} disabled={!canNext}>
              Continue
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!canNext || createMutation.isPending}
              onClick={handleCreate}
            >
              <Check className="size-4" />
              {createMutation.isPending ? 'Creating…' : 'Create bot (paused)'}
            </Button>
          )}
        </>
      }
    >
      <Stepper step={step} />
      <div className="mt-6">
        {step === 0 && <StepPair state={state} update={update} pairs={PAIRS} />}
        {step === 1 && <StepRange state={state} update={update} />}
        {step === 2 && <StepConfig state={state} update={update} />}
        {step === 3 && (
          <StepConfirm
            state={state}
            update={update}
            validated={validated}
            isValidating={validateMutation.isPending}
            error={validateMutation.error as Error | null}
          />
        )}
      </div>
    </Modal>
  );
}

// ── Stepper ──────────────────────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {STEP_LABELS.map((label, i) => {
        const active = i === step;
        const completed = i < step;
        return (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div
              className={cn(
                'size-6 rounded-full flex items-center justify-center text-2xs font-semibold',
                completed && 'bg-success text-bg-base',
                active && 'bg-primary text-bg-base',
                !active && !completed && 'bg-bg-muted text-text-muted'
              )}
            >
              {completed ? <Check className="size-3" /> : i + 1}
            </div>
            <span
              className={cn(
                'text-2xs uppercase tracking-wider',
                active ? 'text-text-primary font-semibold' : 'text-text-muted'
              )}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <div className="flex-1 h-px bg-border-subtle" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Pair selector ────────────────────────────────────────────────

function StepPair({
  state,
  update,
  pairs,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  pairs: Array<{ value: string; label: string }>;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pairs;
    return pairs.filter(
      (p) =>
        p.label.toLowerCase().includes(q) || p.value.toLowerCase().includes(q)
    );
  }, [pairs, query]);

  return (
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-3">
        Select instrument
      </h3>
      <Input
        placeholder={`Search ${pairs.length} pairs (e.g. SOL, DOGE, BTC)`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-3"
        autoFocus
      />
      <div className="max-h-[400px] overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((p) => {
            const selected = state.pair === p.value;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => update('pair', p.value)}
                className={cn(
                  'p-4 rounded-md border text-left transition-colors',
                  selected
                    ? 'border-primary bg-primary-soft text-text-primary'
                    : 'border-border-subtle bg-bg-surface hover:border-border-default'
                )}
              >
                <div className="font-semibold text-sm">{p.label}</div>
                <div className="text-2xs text-text-muted mt-1">
                  Min size 0.001 · Max leverage 50x
                </div>
              </button>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <p className="text-sm text-text-muted text-center py-8">
            No pairs match "{query}"
          </p>
        )}
      </div>
      <p className="mt-4 text-2xs text-text-muted">
        {filtered.length} of {pairs.length} pairs shown
      </p>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          Direction
        </h3>
        <div className="flex gap-2">
          {(['long', 'short'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => update('direction', d)}
              className={cn(
                'flex-1 h-10 rounded-md border text-sm font-semibold uppercase tracking-wider',
                state.direction === d
                  ? d === 'long'
                    ? 'border-success bg-success-soft text-success'
                    : 'border-danger bg-danger-soft text-danger'
                  : 'border-border-subtle text-text-muted hover:border-border-default'
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Range ────────────────────────────────────────────────────────

function StepRange({
  state,
  update,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
}) {
  const lo = parseFloat(state.lower);
  const hi = parseFloat(state.upper);
  const valid = Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > lo;
  const widthPct = valid ? (((hi - lo) / lo) * 100).toFixed(1) : '—';

  return (
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-3">
        Set price range
      </h3>
      <p className="text-xs text-text-muted mb-4">
        Define the price band where the bot will place orders. Wider ranges
        trade less often but are safer; narrow ranges fill faster but exit the
        range sooner.
      </p>

      {/* E.8: Interactive chart with draggable range lines */}
      <RangePickerChart
        pair={state.pair}
        lower={lo || 0}
        upper={hi || 0}
        onLowerChange={(v) => update('lower', v.toFixed(2))}
        onUpperChange={(v) => update('upper', v.toFixed(2))}
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Lower price (USDT)"
          numeric
          inputMode="decimal"
          value={state.lower}
          onChange={(e) => update('lower', e.target.value)}
        />
        <Input
          label="Upper price (USDT)"
          numeric
          inputMode="decimal"
          value={state.upper}
          onChange={(e) => update('upper', e.target.value)}
        />
      </div>
      {valid ? (
        <p className="mt-4 text-xs text-text-muted">
          Range width: <Mono className="text-text-secondary">{widthPct}%</Mono>
        </p>
      ) : (
        <p className="mt-4 text-xs text-danger">
          Lower price must be greater than 0 and below upper price.
        </p>
      )}
    </div>
  );
}

// ── Step 3: Config ───────────────────────────────────────────────────────

function StepConfig({
  state,
  update,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-text-primary mb-3">
        Capital and grid configuration
      </h3>
      <div className="grid grid-cols-3 gap-4">
        <Input
          label="Investment (USDT)"
          numeric
          inputMode="decimal"
          value={state.investment}
          onChange={(e) => update('investment', e.target.value)}
        />
        <Input
          label="Leverage"
          numeric
          inputMode="numeric"
          value={state.leverage}
          onChange={(e) => update('leverage', e.target.value)}
          helper="1x – 50x"
        />
        <Input
          label="Grid count"
          numeric
          inputMode="numeric"
          value={state.grids}
          onChange={(e) => update('grids', e.target.value)}
          helper={state.virtualEnabled ? '2 – 500 (virtual)' : '2 – 95'}
        />
      </div>

      {/* H.8: Virtual grids */}
      <div className="mt-4 rounded-md border border-border-subtle bg-bg-muted/40 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={state.virtualEnabled}
            onChange={(e) => update('virtualEnabled', e.target.checked)}
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-text-primary">
              Enable virtual grids (break 80-order limit)
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              GRVT caps open orders at 80/instrument. Virtual grids let you define
              up to 500 conceptual levels; only the N closest to market price are
              placed as real orders, and the window rotates as price moves.
            </div>
          </div>
        </label>
        {state.virtualEnabled && (
          <div className="mt-4 grid grid-cols-2 gap-4 pl-7">
            <Input
              label="Active window size"
              numeric
              inputMode="numeric"
              value={state.activeWindowSize}
              onChange={(e) => update('activeWindowSize', e.target.value)}
              helper="20 – 80 (default 70)"
            />
          </div>
        )}
      </div>
      <div className="mt-4">
        <Input
          label="Reinvest profit %"
          numeric
          inputMode="numeric"
          value={state.compoundPct}
          onChange={(e) => update('compoundPct', e.target.value)}
          helper="0 = disabled, 100 = reinvest all profit"
        />
      </div>
      <p className="mt-4 text-xs text-text-muted">
        Effective notional ={' '}
        <Mono className="text-text-secondary">
          {formatUsd(
            parseFloat(state.investment || '0') * parseInt(state.leverage || '0', 10)
          )}
        </Mono>
        . The next step validates the config and computes spacing, qty/level
        and liquidation distance.
      </p>

      <div className="mt-6 rounded-md border border-border-subtle bg-bg-muted/40 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={state.safeguardEnabled}
            onChange={(e) => update('safeguardEnabled', e.target.checked)}
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-text-primary">
              Enable liquidation safeguard
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              Auto-pause this bot when the mark price gets within the chosen
              distance of its estimated liquidation price.
            </div>
          </div>
        </label>

        {state.safeguardEnabled && (
          <div className="mt-4 grid grid-cols-2 gap-4 pl-7">
            <Input
              label="Threshold (%)"
              numeric
              inputMode="decimal"
              value={state.safeguardThresholdPct}
              onChange={(e) => update('safeguardThresholdPct', e.target.value)}
              helper="1 – 50. Triggers when distance to liq ≤ this %"
            />
            <div>
              <label className="block text-2xs uppercase tracking-wider text-text-muted mb-1">
                Action on trigger
              </label>
              <select
                className="w-full h-9 rounded-md border border-border-subtle bg-bg-base px-2 text-sm text-text-primary"
                value={state.safeguardAction}
                onChange={(e) =>
                  update('safeguardAction', e.target.value as 'pause' | 'pause_close')
                }
              >
                <option value="pause">Pause only (keep position)</option>
                <option value="pause_close">Pause and close position</option>
              </select>
            </div>
            <p className="col-span-2 text-2xs text-text-muted flex items-start gap-1.5">
              <AlertTriangle className="size-3 shrink-0 mt-0.5 text-warning" />
              <span>
                Local estimate based on entry price and leverage. Leave a
                buffer — the real liquidation price may differ.
              </span>
            </p>
          </div>
        )}
      </div>

      {/* H.3: Stop-loss / Take-profit */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Input
          label="Stop-loss (%)"
          numeric
          inputMode="decimal"
          value={state.slPct}
          onChange={(e) => update('slPct', e.target.value)}
          helper="Close bot if loss exceeds this % of investment. Empty = disabled."
        />
        <Input
          label="Take-profit (%)"
          numeric
          inputMode="decimal"
          value={state.tpPct}
          onChange={(e) => update('tpPct', e.target.value)}
          helper="Close bot if profit exceeds this % of investment. Empty = disabled."
        />
      </div>

      {/* H.2: Auto-shift range */}
      <div className="mt-4 rounded-md border border-border-subtle bg-bg-muted/40 p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={state.autoShiftEnabled}
            onChange={(e) => update('autoShiftEnabled', e.target.checked)}
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-text-primary">
              Auto-shift range
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              Automatically recenter the grid when price moves beyond the range boundary.
            </div>
          </div>
        </label>
        {state.autoShiftEnabled && (
          <div className="mt-3 pl-7">
            <Input
              label="Shift threshold (%)"
              numeric
              inputMode="decimal"
              value={state.autoShiftPct}
              onChange={(e) => update('autoShiftPct', e.target.value)}
              helper="Trigger shift when price exits range by this % of range width"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step 4: Confirm ──────────────────────────────────────────────────────

function StepConfirm({
  state,
  update,
  validated,
  isValidating,
  error,
}: {
  state: WizardState;
  update: <K extends keyof WizardState>(k: K, v: WizardState[K]) => void;
  validated: ValidateBotResult | null;
  isValidating: boolean;
  error: Error | null;
}) {
  if (isValidating) {
    return (
      <div className="text-sm text-text-muted py-8 text-center animate-pulse">
        Validating configuration…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger-soft/30 p-4">
        <div className="flex items-start gap-2 text-danger">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold">Validation failed</div>
            <div className="text-xs mt-1">{error.message}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!validated) return null;

  const c = validated.computed;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">
        Review and create
      </h3>

      <SummaryGrid>
        <SummaryItem label="Pair" value={validated.pair} mono={false} />
        <SummaryItem label="Direction" value={validated.direction.toUpperCase()} mono={false} />
        <SummaryItem label="Leverage" value={`${validated.input.leverage}x`} />
        <SummaryItem
          label="Range"
          value={`${formatUsd(validated.input.lower)} — ${formatUsd(validated.input.upper)}`}
        />
        <SummaryItem label="Grids" value={`${validated.input.grids} levels`} />
        <SummaryItem label="Investment" value={formatUsd(validated.input.investment)} />
      </SummaryGrid>

      <hr className="border-border-subtle" />

      <h4 className="text-2xs uppercase tracking-wider text-text-muted">
        Computed parameters
      </h4>
      <SummaryGrid>
        <SummaryItem label="Spacing" value={`${formatUsd(c.spacing)} (${c.spacingPct}%)`} />
        <SummaryItem label="Qty / level" value={formatSize(c.qtyPerLevel)} />
        <SummaryItem label="Notional" value={formatUsd(c.notional)} />
        <SummaryItem label="Profit / round-trip" value={formatPnl(c.profitPerRoundTrip)} />
        <SummaryItem
          label="Est. liquidation"
          value={formatUsd(c.liquidationEstimate)}
        />
        <SummaryItem
          label="Liq. distance"
          value={formatPercent(-c.liqDistancePct)}
        />
      </SummaryGrid>

      {validated.warnings.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning-soft/30 p-3">
          <div className="flex items-start gap-2 text-warning text-xs">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Warnings</div>
              <ul className="mt-1 space-y-0.5 list-disc list-inside">
                {validated.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-md border border-border-default bg-bg-surface p-3 text-xs text-text-muted">
        ⓘ The bot will be created in <strong className="text-text-secondary">paused</strong>{' '}
        state. No orders will be placed on GRVT until you explicitly press
        Start from the bot detail page after reviewing the configuration.
      </div>

      <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={state.acceptedRisk}
          onChange={(e) => update('acceptedRisk', e.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          I understand this bot will use real funds and risk liquidation up to{' '}
          <Mono>{formatUsd(validated.input.investment)}</Mono>.
        </span>
      </label>
    </div>
  );
}

function SummaryGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</dl>;
}

function SummaryItem({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border-subtle pb-1.5">
      <dt className="text-2xs uppercase tracking-wider text-text-muted">
        {label}
      </dt>
      <dd className={mono ? 'font-mono text-xs text-text-primary' : 'text-xs text-text-primary'}>
        {value}
      </dd>
    </div>
  );
}
