/**
 * Server-side tool handlers. Pure functions of (session, validated input).
 *
 * Every number comes from the domain module. Mutating tools only create
 * hypothetical scenarios or unsent drafts in the run's private session copy.
 */
import {
  DEMO_TODAY,
  addDays,
  buildPaymentDelayScenario,
  calculateDatasetCashFlow,
  formatBani,
  isBusinessDate,
  parseRonToBani,
  regenerateDraft,
  sameDraftContent,
  summarizeForecast,
  type Bani,
  type CashEvent,
  type DailyCashFlowResult,
  type DemoDataset,
  type RecoveryOptionResult,
  type Scenario,
} from "@/domain";

import {
  UNTRUSTED_TEXT_NOTICE,
  type Money,
  type ToolError,
  type ToolMutation,
  type ToolResult,
} from "./envelope";
import {
  activeForecastOf,
  delayOf,
  freshnessOf,
  generateDraftFor,
  recoveryComparisonOf,
} from "@/state/active-case";

import { AGENT_LIMITS } from "./limits";
import type { ToolInput, ToolName } from "./schemas";
import { dispatchToSession, type ToolSession } from "./session";

const money = (amount: number): Money => ({ bani: amount, text: formatBani(amount as Bani) });

function base(session: ToolSession, tool: ToolName) {
  return {
    tool,
    datasetVersion: session.state.baseline.datasetVersion,
    revision: session.state.revision,
  };
}

function fail(
  session: ToolSession,
  tool: ToolName,
  code: ToolError["code"],
  message: string,
  issues: readonly string[] = [],
): ToolResult {
  return {
    ...base(session, tool),
    ok: false,
    error: { code, message, issues },
    summary: `Error (${code}): ${message}`,
  };
}

function ok<T>(
  session: ToolSession,
  tool: ToolName,
  payload: {
    data: T;
    summary: string;
    sourceIds: readonly string[];
    assumptions: readonly string[];
    mutation?: ToolMutation | null;
  },
): ToolResult<T> {
  return {
    ...base(session, tool),
    ok: true,
    data: payload.data,
    summary: payload.summary,
    sourceIds: payload.sourceIds,
    assumptions: payload.assumptions,
    mutation: payload.mutation ?? null,
  };
}

function activeDelay(session: ToolSession): Scenario | null {
  return delayOf(session.state);
}

/** Events, result and assumptions for the requested view. Throws domain errors. */
function viewOf(session: ToolSession, view: "baseline" | "active_case") {
  const baseline = session.state.baseline;
  const f = view === "active_case" ? activeForecastOf(session.state) : null;
  if (!f) {
    return {
      dataset: baseline,
      result: calculateDatasetCashFlow(baseline, DEMO_TODAY),
      scenario: null as Scenario | null,
      note:
        view === "active_case"
          ? "No payment delay or accepted proposal is active, so the active case equals the baseline."
          : null,
    };
  }
  const accepted = session.state.acceptedChanges.length;
  return {
    dataset: f.view,
    result: f.result,
    scenario: f.scenario,
    note: accepted
      ? `Active case includes ${accepted} accepted proposal(s) (simulated responses; forecast changes only, no cash moved).`
      : null,
  };
}

function forecastSummary(dataset: DemoDataset, result: DailyCashFlowResult) {
  const summary = summarizeForecast(dataset, result, DEMO_TODAY);
  return {
    basis: result.basis,
    currency: result.currency,
    horizon: result.horizon,
    openingBalance: money(result.openingBalance),
    minimumClosingBalance: money(result.minimumClosingBalance),
    minimumClosingDate: result.minimumClosingDate,
    firstNegativeClosingDate: result.firstNegativeClosingDate,
    shortfall: money(result.shortfall),
    endingBalance: money(result.endingBalance),
    recoveryDate: summary.recoveryDate,
    temporaryShortfall: summary.temporaryShortfall,
    excludedEvents: result.excludedEvents,
  };
}

function eventDto(e: CashEvent) {
  return {
    id: e.id,
    date: e.date,
    direction: e.direction,
    amount: money(e.amount),
    category: e.category,
    untrustedText: { description: e.description, counterparty: e.counterparty },
    status: e.status,
    layer: e.layer,
    source: e.source,
    ...(e.split ? { split: e.split } : {}),
  };
}

const assumptionTexts = (dataset: DemoDataset, scenario: Scenario | null) => [
  ...dataset.assumptions.map((a) => a.text),
  ...(scenario?.assumptions.map((a) => a.text) ?? []),
];

function guard(session: ToolSession, tool: ToolName, run: () => ToolResult): ToolResult {
  try {
    return run();
  } catch (error) {
    const issues =
      error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)
        ? (error.issues as unknown[]).map(String)
        : [];
    return fail(
      session,
      tool,
      "calculation_error",
      error instanceof Error ? error.message.split("\n")[0]! : "Calculation failed",
      issues,
    );
  }
}

// ---------------------------------------------------------------------------

export function getBusinessContext(
  session: ToolSession,
  _input: ToolInput<"get_business_context">,
) {
  const tool = "get_business_context";
  return guard(session, tool, () => {
    const { baseline, cashBuffer, rejectedOptions, scenarios, actionDrafts, activeSource } =
      session.state;
    const p = baseline.profile;
    const delay = activeDelay(session);
    const shift = delay?.adjustments.find((a) => a.type === "shift_event");
    const openReceivables = baseline.receivables
      .filter((r) => r.status === "open")
      .map((r) => ({
        id: r.id,
        documentNumber: r.documentNumber,
        untrustedText: { counterparty: r.counterparty },
        amount: money(r.amount),
        expectedDate: r.expectedDate,
      }));
    return ok(session, tool, {
      data: {
        businessName: p.name,
        currency: p.currency,
        timezone: p.timezone,
        demoToday: DEMO_TODAY,
        openingBalance: {
          ...money(p.openingBalance.amount),
          asOf: p.openingBalance.asOf,
          position: p.openingBalance.position,
        },
        horizon: p.horizon,
        dataSource: activeSource.kind,
        dataNotice: UNTRUSTED_TEXT_NOTICE,
        constraints: {
          minimumCashBuffer: money(cashBuffer),
          rejectedOptions,
        },
        counts: {
          cashEvents: baseline.cashEvents.length,
          receivables: baseline.receivables.length,
          scenarios: scenarios.length,
          actionDrafts: actionDrafts.length,
        },
        openReceivables,
        acceptedProposals: session.state.acceptedChanges.map((c) => ({
          id: c.id,
          optionId: c.optionId,
          label: c.label,
          acceptedOn: c.businessDate,
          note: "Simulated acceptance; forecast change only. No cash moved, invoices stay open.",
        })),
        actionDrafts: actionDrafts.map((d) => ({
          id: d.id,
          optionId: d.optionId,
          status: d.status,
          freshness: freshnessOf(session.state, d).kind,
        })),
        activeDelay:
          delay && shift && shift.type === "shift_event"
            ? {
                scenarioId: delay.id,
                eventId: shift.eventId,
                newDate: shift.newDate,
                label: delay.label,
              }
            : null,
      },
      summary: `${p.name}: opening ${formatBani(p.openingBalance.amount)} on ${p.openingBalance.asOf}, horizon ${p.horizon.start} to ${p.horizon.end}, ${openReceivables.length} open receivable(s), ${delay ? "delay active" : "no delay"}, buffer ${formatBani(cashBuffer)}, ${rejectedOptions.length} rejected option(s), ${session.state.acceptedChanges.length} accepted proposal(s)`,
      sourceIds: [p.id, ...openReceivables.map((r) => r.id), ...(delay ? [delay.id] : [])],
      assumptions: assumptionTexts(baseline, delay),
    });
  });
}

export function getCashEvents(session: ToolSession, input: ToolInput<"get_cash_events">) {
  const tool = "get_cash_events";
  const issues: string[] = [];
  for (const [label, value] of [
    ["fromDate", input.fromDate],
    ["toDate", input.toDate],
  ] as const) {
    if (value !== null && !isBusinessDate(value))
      issues.push(`${label} "${value}" is not a valid YYYY-MM-DD date`);
  }
  if (input.fromDate && input.toDate && input.fromDate > input.toDate) {
    issues.push("fromDate must not be after toDate");
  }
  const limit = input.limit ?? 50;
  if (limit < 1 || limit > AGENT_LIMITS.maxEventsPerCall) {
    issues.push(`limit must be between 1 and ${AGENT_LIMITS.maxEventsPerCall}`);
  }
  if (issues.length)
    return fail(session, tool, "invalid_input", "Invalid get_cash_events input", issues);

  return guard(session, tool, () => {
    const v = viewOf(session, input.view);
    const matching = v.dataset.cashEvents.filter(
      (e) =>
        (input.fromDate === null || e.date >= input.fromDate) &&
        (input.toDate === null || e.date <= input.toDate) &&
        (input.direction === null || e.direction === input.direction),
    );
    const events = matching.slice(0, limit).map(eventDto);
    return ok(session, tool, {
      data: {
        view: input.view,
        note: v.note,
        dataNotice: UNTRUSTED_TEXT_NOTICE,
        totalMatching: matching.length,
        truncated: matching.length > limit,
        events,
      },
      summary: `${events.length} of ${matching.length} event(s) (${input.view}${input.direction ? `, ${input.direction}` : ""})`,
      sourceIds: events.map((e) => e.id),
      assumptions: assumptionTexts(v.dataset, v.scenario),
    });
  });
}

export function calculateForecast(session: ToolSession, input: ToolInput<"calculate_forecast">) {
  const tool = "calculate_forecast";
  return guard(session, tool, () => {
    const v = viewOf(session, input.view);
    const s = forecastSummary(v.dataset, v.result);
    return ok(session, tool, {
      data: {
        view: input.view,
        note: v.note,
        scenarioId: v.scenario?.id ?? null,
        ...s,
        dailyRows: input.includeDailyRows
          ? v.result.days.map((d) => ({ date: d.date, closingBalance: money(d.closingBalance) }))
          : null,
      },
      summary: `${input.view}: lowest ${s.minimumClosingBalance.text} on ${s.minimumClosingDate}; ${s.firstNegativeClosingDate ? `first negative ${s.firstNegativeClosingDate}` : "no negative day"}; ending ${s.endingBalance.text}`,
      sourceIds: [...v.result.includedEventIds, ...(v.scenario ? [v.scenario.id] : [])],
      assumptions: assumptionTexts(v.dataset, v.scenario),
    });
  });
}

export function simulatePaymentDelay(
  session: ToolSession,
  input: ToolInput<"simulate_payment_delay">,
) {
  const tool = "simulate_payment_delay";
  const baseline = session.state.baseline;
  const receivable = baseline.receivables.find(
    (r) => r.documentNumber.toUpperCase() === input.documentNumber.trim().toUpperCase(),
  );
  if (!receivable) {
    return fail(
      session,
      tool,
      "not_found",
      `No receivable with document number "${input.documentNumber}"`,
      [
        `Open receivables: ${baseline.receivables.map((r) => r.documentNumber).join(", ") || "none"}`,
      ],
    );
  }
  if ((input.delayDays === null) === (input.newDate === null)) {
    return fail(session, tool, "invalid_input", "Give exactly one of delayDays or newDate", [
      "Use delayDays for 'N days late', newDate only for an explicit date.",
    ]);
  }
  if (input.delayDays !== null && (input.delayDays < 1 || input.delayDays > 365)) {
    return fail(session, tool, "invalid_input", "delayDays must be between 1 and 365");
  }
  if (input.newDate !== null && !isBusinessDate(input.newDate)) {
    return fail(
      session,
      tool,
      "invalid_input",
      `newDate "${input.newDate}" is not a valid YYYY-MM-DD date`,
    );
  }
  // Days are counted from the original (baseline) expected date, never from an earlier delay.
  const newDate =
    input.delayDays !== null ? addDays(receivable.expectedDate, input.delayDays) : input.newDate!;
  const built = buildPaymentDelayScenario(baseline, receivable.id, newDate, DEMO_TODAY);
  if (!built.ok)
    return fail(session, tool, "invalid_input", "The delay is not valid", built.errors);

  return guard(session, tool, () => {
    const before = activeDelay(session);
    const revisionBefore = session.state.revision;
    dispatchToSession(session, { type: "upsert_scenario", scenario: built.scenario });
    const changed = session.state.revision !== revisionBefore;
    if (changed) session.changedScenarioIds.add(built.scenario.id);
    // The active case: this delay plus any accepted proposals (which override it per event).
    const f = activeForecastOf(session.state)!;
    const s = forecastSummary(f.view, f.result);
    return ok(session, tool, {
      data: {
        scenarioId: built.scenario.id,
        status: "hypothetical",
        originalDate: receivable.expectedDate,
        newDate,
        delayDays: input.delayDays,
        moved: f.moved,
        outsideHorizon: f.outsideHorizon,
        delayedCase: s,
        acceptedProposals: session.state.acceptedChanges.map((c) => c.label),
        note: "Hypothetical scenario only: the baseline is unchanged and no payment has moved. Accepted proposals, if any, are included and take precedence for the same event.",
      },
      summary: `${receivable.documentNumber} moved from ${receivable.expectedDate} to ${newDate} (hypothetical): lowest ${s.minimumClosingBalance.text} on ${s.minimumClosingDate}; ending ${s.endingBalance.text}`,
      sourceIds: [built.scenario.id, receivable.id, receivable.cashEventId],
      assumptions: assumptionTexts(baseline, built.scenario),
      mutation: {
        kind: "scenario",
        id: built.scenario.id,
        change: !changed ? "unchanged" : before ? "updated" : "created",
        hypothetical: true,
      },
    });
  });
}

function optionDto(o: RecoveryOptionResult) {
  if (!o.available) {
    return {
      id: o.terms.id,
      letter: o.terms.letter,
      title: o.terms.title,
      available: false as const,
      rejectedByUser: o.rejected,
      alreadyAccepted: o.accepted,
      reason: o.reason,
    };
  }
  return {
    id: o.terms.id,
    letter: o.terms.letter,
    title: o.terms.title,
    available: true as const,
    status: o.status,
    scenarioId: o.scenario.id,
    lowestCash: money(o.result.minimumClosingBalance),
    lowestCashDate: o.result.minimumClosingDate,
    endingCash: money(o.result.endingBalance),
    totalExplicitCost: money(o.totalCost),
    costs: o.costs.map((c) => ({ label: c.label, amount: money(c.amount), note: c.note })),
    conditions: o.conditions,
    approvals: o.approvals,
    disclosures: o.disclosures,
    outsideHorizon: o.outsideHorizon.map((x) => ({ ...x, amount: money(x.amount) })),
    passesBuffer: o.passesBuffer,
    bufferGap: money(o.bufferGap),
  };
}

function comparisonFor(session: ToolSession, buffer: Bani) {
  return recoveryComparisonOf(session.state, buffer);
}

export function compareRecoveryScenarios(
  session: ToolSession,
  input: ToolInput<"compare_recovery_scenarios">,
) {
  const tool = "compare_recovery_scenarios";
  let buffer = session.state.cashBuffer;
  if (input.bufferRon !== null) {
    try {
      buffer = parseRonToBani(input.bufferRon.trim());
      if (buffer < 0) throw new RangeError("negative");
    } catch {
      return fail(
        session,
        tool,
        "invalid_input",
        `bufferRon "${input.bufferRon}" must be a RON amount of 0 or more, e.g. "1000.00"`,
      );
    }
  }
  if (!activeDelay(session)) {
    return fail(
      session,
      tool,
      "precondition_failed",
      "No payment delay is active. Call simulate_payment_delay first.",
    );
  }
  return guard(session, tool, () => {
    const c = comparisonFor(session, buffer)!;
    const options = c.options.map(optionDto);
    const rejectedCount = c.options.filter((o) => !o.available && o.rejected).length;
    const findingText =
      c.finding.kind === "all_fail"
        ? `no option meets the ${formatBani(buffer)} buffer${rejectedCount ? ` (${rejectedCount} rejected, not evaluated)` : ""}`
        : c.finding.kind === "delayed_case_meets_buffer"
          ? "delayed case already meets the buffer"
          : `${c.finding.passing.length} of ${options.length} options meet the ${formatBani(buffer)} buffer`;
    return ok(session, tool, {
      data: {
        basedOn: {
          datasetVersion: c.datasetVersion,
          delayScenarioId: c.delayScenario.id,
          revision: session.state.revision,
        },
        buffer: money(buffer),
        bufferSource: input.bufferRon === null ? "session" : "request",
        delayedCase: {
          lowestCash: money(c.delayed.minimumClosingBalance),
          lowestCashDate: c.delayed.minimumClosingDate,
          endingCash: money(c.delayed.endingBalance),
        },
        options,
        finding:
          c.finding.kind === "all_fail"
            ? {
                ...c.finding,
                closestGap: c.finding.closestGap === null ? null : money(c.finding.closestGap),
              }
            : c.finding,
        rejectedOptions: session.state.rejectedOptions,
        note:
          c.finding.kind === "all_fail"
            ? "No evaluated option meets the buffer. Do not present any option as sufficient; report this and ask whether the user wants to change a constraint. Options are never combined automatically."
            : "Options are independent hypothetical comparisons. None is agreed or approved; they are never combined automatically.",
      },
      summary: `Compared ${options.length} options: ${findingText}`,
      sourceIds: [
        c.delayScenario.id,
        ...c.options.flatMap((o) => (o.available ? [o.scenario.id] : [])),
      ],
      assumptions: [
        ...assumptionTexts(session.state.baseline, c.delayScenario),
        ...c.options.flatMap((o) => (o.available ? o.disclosures : [])),
      ],
    });
  });
}

export function prepareActionDraft(session: ToolSession, input: ToolInput<"prepare_action_draft">) {
  const tool = "prepare_action_draft";
  if (!activeDelay(session)) {
    return fail(
      session,
      tool,
      "precondition_failed",
      "No payment delay is active. Call simulate_payment_delay first.",
    );
  }
  const existing = session.state.actionDrafts.find((d) => d.optionId === input.optionId);
  if (existing && existing.status !== "draft") {
    return fail(
      session,
      tool,
      "precondition_failed",
      `A draft for this option is already ${existing.status.replace("_", " ")}; it is not regenerated`,
      [`Draft ${existing.id}`],
    );
  }
  return guard(session, tool, () => {
    const generated = generateDraftFor(session.state, input.optionId, new Date().toISOString());
    if (!generated.ok) {
      return fail(session, tool, "precondition_failed", "This option cannot be drafted", [
        generated.reason,
      ]);
    }
    const fresh = generated.draft;
    const keep =
      existing &&
      sameDraftContent(existing, fresh) &&
      freshnessOf(session.state, existing).kind === "current";
    const draft = keep ? existing : regenerateDraft(existing, fresh);
    const change = !existing ? "created" : keep ? "unchanged" : "updated";
    if (!keep) {
      dispatchToSession(session, { type: "upsert_action_draft", draft });
      session.changedDraftIds.add(draft.id);
    }
    const option = comparisonFor(session, session.state.cashBuffer)!.options.find(
      (o) => o.terms.id === input.optionId,
    )!;
    return ok(session, tool, {
      data: {
        draft: {
          id: draft.id,
          kind: draft.kind,
          format: draft.format,
          recipient: draft.recipientLabel,
          subject: draft.subject,
          body: draft.format === "brief" ? `${draft.body.slice(0, 1500)}…` : draft.body,
          status: draft.status,
        },
        approvalsStillRequired: option.available ? option.approvals : [],
        note: "Draft stored for review only. Nothing was sent. The user can edit it, copy it, and simulate acceptance or rejection on the Actions page; you cannot.",
      },
      summary: `Draft ${draft.id} for option ${option.terms.letter} (${change}); not sent`,
      sourceIds: [draft.id, ...(draft.scenarioId ? [draft.scenarioId] : [])],
      assumptions: option.available ? option.disclosures : [],
      mutation: { kind: "action_draft", id: draft.id, change, hypothetical: true },
    });
  });
}

export function updatePlanningConstraints(
  session: ToolSession,
  input: ToolInput<"update_planning_constraints">,
) {
  const tool = "update_planning_constraints";
  const issues: string[] = [];
  let buffer: Bani | null = null;
  if (input.minimumCashBufferRon !== null) {
    try {
      buffer = parseRonToBani(input.minimumCashBufferRon.trim());
      if (buffer < 0) throw new RangeError("negative");
    } catch {
      issues.push(
        `minimumCashBufferRon "${input.minimumCashBufferRon}" must be a RON amount of 0 or more, e.g. "2000.00"`,
      );
    }
  }
  const reason = input.rejectionReason?.trim() ?? "";
  if (input.rejectOptionId !== null && !reason)
    issues.push("rejectionReason is required with rejectOptionId");
  if (reason.length > 200) issues.push("rejectionReason must be at most 200 characters");
  if (input.rejectOptionId !== null && input.rejectOptionId === input.reinstateOptionId) {
    issues.push("Cannot reject and reinstate the same option");
  }
  if (
    buffer === null &&
    input.rejectOptionId === null &&
    input.reinstateOptionId === null &&
    !issues.length
  ) {
    issues.push("Nothing to change: give a buffer, an option to reject or an option to reinstate");
  }
  if (issues.length) return fail(session, tool, "invalid_input", "Invalid constraint", issues);

  return guard(session, tool, () => {
    const revisionBefore = session.state.revision;
    if (buffer !== null) dispatchToSession(session, { type: "set_cash_buffer", amount: buffer });
    let rejected = session.state.rejectedOptions.filter(
      (r) => r.optionId !== input.reinstateOptionId && r.optionId !== input.rejectOptionId,
    );
    if (input.rejectOptionId !== null)
      rejected = [...rejected, { optionId: input.rejectOptionId, reason }];
    dispatchToSession(session, { type: "set_rejected_options", options: rejected });
    const changed = session.state.revision !== revisionBefore;
    const { cashBuffer, rejectedOptions } = session.state;
    return ok(session, tool, {
      data: {
        minimumCashBuffer: money(cashBuffer),
        rejectedOptions,
        note: "Planning constraint recorded for this session. No money moved and nobody was contacted.",
      },
      summary: `Constraints: buffer ${formatBani(cashBuffer)}; rejected ${rejectedOptions.map((r) => r.optionId).join(", ") || "none"}${changed ? "" : " (unchanged)"}`,
      sourceIds: rejectedOptions.map((r) => r.optionId),
      assumptions: [],
      mutation: {
        kind: "constraints",
        id: "planning-constraints",
        change: changed ? "updated" : "unchanged",
        hypothetical: true,
      },
    });
  });
}

export function requestMissingInformation(
  session: ToolSession,
  input: ToolInput<"request_missing_information">,
) {
  const tool = "request_missing_information";
  const question = input.question.trim();
  if (!question || question.length > 500) {
    return fail(session, tool, "invalid_input", "question must be 1-500 characters");
  }
  session.missingInformation.push(question);
  return ok(session, tool, {
    data: { recorded: true, note: "Ask the user this question in your answer and stop." },
    summary: `Asked the user: ${question}`,
    sourceIds: [],
    assumptions: [],
  });
}

/** Dispatch table used by the runner. */
export const TOOL_HANDLERS: { [N in ToolName]: (s: ToolSession, i: ToolInput<N>) => ToolResult } = {
  get_business_context: getBusinessContext,
  get_cash_events: getCashEvents,
  calculate_forecast: calculateForecast,
  simulate_payment_delay: simulatePaymentDelay,
  compare_recovery_scenarios: compareRecoveryScenarios,
  prepare_action_draft: prepareActionDraft,
  update_planning_constraints: updatePlanningConstraints,
  request_missing_information: requestMissingInformation,
};
