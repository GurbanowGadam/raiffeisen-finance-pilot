/**
 * Recovery options evaluated against the delayed case. Pure and deterministic.
 *
 * Each option is an independent hypothetical scenario: the delayed case plus
 * that option's own adjustments. Options are never combined. Every number
 * comes from `calculateDailyCashFlow`; nothing is estimated or invented.
 * If no option meets the cash buffer, the comparison says so.
 */
import type { DailyCashFlowResult } from "./cash-flow";
import { isBusinessDate } from "./dates";
import type { CashEvent, DemoDataset, RecoveryTerms, Scenario, ScenarioAdjustment } from "./models";
import { bani, formatBani } from "./money";
import { calculateScenarioCashFlow } from "./scenarios";
import type { Bani, BusinessDate } from "./types";

export interface RecoveryCost {
  readonly label: string;
  readonly amount: Bani;
  readonly note: string | null;
}

export interface RecoveryApproval {
  readonly party: string;
  readonly kind: "counterparty_acceptance" | "bank_approval";
  readonly description: string;
  /** Approvals are never assumed. Simulation of acceptance comes in a later step. */
  readonly status: "not_requested";
}

export interface OutsideHorizonItem {
  readonly eventId: string;
  readonly description: string;
  readonly date: BusinessDate;
  readonly direction: CashEvent["direction"];
  readonly amount: Bani;
}

interface OptionMeta {
  readonly conditions: readonly string[];
  readonly costs: readonly RecoveryCost[];
  readonly approvals: readonly RecoveryApproval[];
  readonly disclosures: readonly string[];
}

export type RecoveryOptionResult =
  | {
      readonly available: false;
      readonly terms: RecoveryTerms;
      readonly reason: string;
      /** True when the user rejected the option (e.g. counterparty refused), not missing data. */
      readonly rejected: boolean;
      /** True when the option's proposal was accepted and is already in the active case. */
      readonly accepted: boolean;
    }
  | ({
      readonly available: true;
      readonly terms: RecoveryTerms;
      readonly status: "hypothetical";
      readonly scenario: Scenario;
      readonly result: DailyCashFlowResult;
      readonly totalCost: Bani;
      readonly outsideHorizon: readonly OutsideHorizonItem[];
      readonly passesBuffer: boolean;
      /** max(0, buffer - minimum closing balance). */
      readonly bufferGap: Bani;
      /** Minimum closing balance is at or above 0 RON. */
      readonly resolvesShortfall: boolean;
    } & OptionMeta);

export type RecoveryFinding =
  | { readonly kind: "delayed_case_meets_buffer" }
  | { readonly kind: "options_meet_buffer"; readonly passing: readonly string[] }
  | {
      readonly kind: "all_fail";
      readonly evaluated: number;
      /** Smallest buffer gap among evaluated options; null when none could be evaluated. */
      readonly closestGap: Bani | null;
    };

export interface RecoveryComparison {
  /** Every option was computed from this dataset version and this delay scenario. */
  readonly datasetVersion: string;
  readonly delayScenario: Scenario;
  readonly buffer: Bani;
  readonly delayed: DailyCashFlowResult;
  readonly options: readonly RecoveryOptionResult[];
  readonly finding: RecoveryFinding;
}

type BuildResult =
  | { readonly ok: true; readonly scenario: Scenario; readonly meta: OptionMeta }
  | { readonly ok: false; readonly reason: string };

function findDocumentEvent(dataset: DemoDataset, documentNumber: string) {
  return dataset.cashEvents.find((e) => e.source.documentNumber === documentNumber) ?? null;
}

/** Date of an event in the delayed case (shifted date if the delay moved it). */
function delayedDateOf(event: CashEvent, delay: Scenario): BusinessDate {
  const shift = delay.adjustments.find(
    (a) => a.type === "shift_event" && a.eventId === event.id,
  ) as Extract<ScenarioAdjustment, { type: "shift_event" }> | undefined;
  return shift?.newDate ?? event.date;
}

function checkDate(label: string, date: string, dataset: DemoDataset, today: BusinessDate) {
  if (!isBusinessDate(date)) return `${label} "${date}" is not a valid date`;
  if (date < today) return `${label} ${date} is before today (${today})`;
  if (date < dataset.profile.horizon.start) return `${label} ${date} is before the forecast start`;
  return null;
}

function scenarioShell(
  dataset: DemoDataset,
  delay: Scenario,
  terms: RecoveryTerms,
  adjustments: ScenarioAdjustment[],
  description: string,
  today: BusinessDate,
): Scenario {
  return {
    id: `scn-${terms.id}`,
    label: `${terms.letter}. ${terms.title}`,
    description,
    status: "hypothetical",
    baseDatasetVersion: dataset.datasetVersion,
    createdOn: today,
    adjustments,
    assumptions: [
      ...delay.assumptions,
      {
        id: `asm-${terms.id}`,
        kind: "data",
        text: `Hypothetical option ${terms.letter}: ${description} Not agreed or approved.`,
      },
    ],
    sources: [{ kind: "scenario", id: delay.id, documentNumber: null }],
  };
}

/** Builds one recovery option on top of the delay scenario. Never combines options. */
export function buildRecoveryScenario(
  dataset: DemoDataset,
  delay: Scenario,
  terms: RecoveryTerms,
  today: BusinessDate,
): BuildResult {
  switch (terms.kind) {
    case "partial_collection": {
      const event = findDocumentEvent(dataset, terms.documentNumber);
      if (!event || event.source.kind !== "receivable" || event.direction !== "inflow") {
        return { ok: false, reason: `Receivable ${terms.documentNumber} is not in the dataset` };
      }
      const remainderDate = delayedDateOf(event, delay);
      const dateIssue = checkDate("Part-payment date", terms.partialDate, dataset, today);
      if (dateIssue) return { ok: false, reason: dateIssue };
      if (terms.partialAmount >= event.amount) {
        return {
          ok: false,
          reason: `Part-payment ${formatBani(terms.partialAmount)} must be less than ${formatBani(event.amount)}`,
        };
      }
      if (terms.partialDate >= remainderDate) {
        return {
          ok: false,
          reason: `In the delayed case ${terms.documentNumber} already arrives on ${remainderDate}, not after the part-payment date ${terms.partialDate}`,
        };
      }
      const remainder = bani(event.amount - terms.partialAmount);
      const party = event.counterparty ?? "The customer";
      const description = `${party} pays ${formatBani(terms.partialAmount)} of ${terms.documentNumber} on ${terms.partialDate}; the remaining ${formatBani(remainder)} stays due on ${remainderDate}.`;
      // The split replaces the delay's shift for this event (parts carry absolute dates).
      const adjustments: ScenarioAdjustment[] = [
        ...delay.adjustments.filter((a) => !("eventId" in a) || a.eventId !== event.id),
        {
          type: "split_event",
          eventId: event.id,
          parts: [
            { id: `${event.id}-part-1`, date: terms.partialDate, amount: terms.partialAmount },
            { id: `${event.id}-part-2`, date: remainderDate, amount: remainder },
          ],
        },
      ];
      return {
        ok: true,
        scenario: scenarioShell(dataset, delay, terms, adjustments, description, today),
        meta: {
          conditions: [
            `${party} agrees to pay ${formatBani(terms.partialAmount)} of ${terms.documentNumber} on ${terms.partialDate}.`,
            `The remaining ${formatBani(remainder)} stays due on ${remainderDate}. The receivable total stays ${formatBani(event.amount)}.`,
          ],
          costs: [
            {
              label: "Direct cost",
              amount: bani(0),
              note: "No discount or fee is part of these demo terms.",
            },
          ],
          approvals: [
            {
              party,
              kind: "counterparty_acceptance",
              description: `${party} must accept paying ${formatBani(terms.partialAmount)} early.`,
              status: "not_requested",
            },
          ],
          disclosures: [],
        },
      };
    }

    case "supplier_deferral": {
      const event = findDocumentEvent(dataset, terms.documentNumber);
      if (!event || event.direction !== "outflow") {
        return {
          ok: false,
          reason: `Supplier invoice ${terms.documentNumber} is not in the dataset`,
        };
      }
      for (const [label, date] of [
        ["First payment date", terms.firstDate],
        ["Second payment date", terms.secondDate],
      ] as const) {
        const issue = checkDate(label, date, dataset, today);
        if (issue) return { ok: false, reason: issue };
      }
      if (terms.secondDate <= terms.firstDate) {
        return { ok: false, reason: "The second payment must be after the first payment" };
      }
      if (terms.firstAmount >= event.amount) {
        return {
          ok: false,
          reason: `First payment ${formatBani(terms.firstAmount)} must be less than ${formatBani(event.amount)}`,
        };
      }
      const rest = bani(event.amount - terms.firstAmount);
      const party = event.counterparty ?? "The supplier";
      const description = `${party} accepts ${formatBani(terms.firstAmount)} of ${terms.documentNumber} on ${terms.firstDate} and the remaining ${formatBani(rest)} on ${terms.secondDate}.`;
      const adjustments: ScenarioAdjustment[] = [
        ...delay.adjustments,
        {
          type: "split_event",
          eventId: event.id,
          parts: [
            { id: `${event.id}-part-1`, date: terms.firstDate, amount: terms.firstAmount },
            { id: `${event.id}-part-2`, date: terms.secondDate, amount: rest },
          ],
        },
      ];
      if (terms.fee > 0) {
        adjustments.push({
          type: "add_event",
          event: {
            id: `${terms.id}-fee`,
            date: terms.secondDate,
            direction: "outflow",
            amount: terms.fee,
            currency: "RON",
            category: "supplier",
            description: `Deferral fee for ${terms.documentNumber}`,
            counterparty: event.counterparty,
            status: "forecast",
            layer: "scenario",
            source: { kind: "scenario", id: `scn-${terms.id}`, documentNumber: null },
          },
        });
      }
      return {
        ok: true,
        scenario: scenarioShell(dataset, delay, terms, adjustments, description, today),
        meta: {
          conditions: [
            `${party} agrees to accept ${formatBani(terms.firstAmount)} on ${terms.firstDate} and ${formatBani(rest)} on ${terms.secondDate}.`,
            `Total payment stays ${formatBani(event.amount)}.`,
          ],
          costs: [{ label: "Supplier fee", amount: terms.fee, note: terms.feeAssumption }],
          approvals: [
            {
              party,
              kind: "counterparty_acceptance",
              description: `${party} must accept the split payment.`,
              status: "not_requested",
            },
          ],
          disclosures: [terms.feeAssumption],
        },
      };
    }

    case "financing": {
      for (const [label, date] of [
        ["Disbursement date", terms.disbursementDate],
        ["Fee date", terms.feeDate],
        ["Repayment date", terms.repaymentDate],
      ] as const) {
        const issue = checkDate(label, date, dataset, today);
        if (issue) return { ok: false, reason: issue };
      }
      if (terms.repaymentDate <= terms.disbursementDate) {
        return { ok: false, reason: "Repayment must be after the disbursement" };
      }
      const source = { kind: "scenario" as const, id: `scn-${terms.id}`, documentNumber: null };
      const base = {
        currency: "RON" as const,
        category: "financing" as const,
        counterparty: terms.lenderLabel,
        status: "forecast" as const,
        layer: "scenario" as const,
        source,
      };
      const adjustments: ScenarioAdjustment[] = [
        ...delay.adjustments,
        {
          type: "add_event",
          event: {
            ...base,
            id: `${terms.id}-disbursement`,
            date: terms.disbursementDate,
            direction: "inflow",
            amount: terms.principal,
            description: "Fictional financing disbursement",
          },
        },
        {
          type: "add_event",
          event: {
            ...base,
            id: `${terms.id}-repayment`,
            date: terms.repaymentDate,
            direction: "outflow",
            amount: terms.principal,
            description: "Fictional financing principal repayment",
          },
        },
      ];
      if (terms.fee > 0) {
        adjustments.push({
          type: "add_event",
          event: {
            ...base,
            id: `${terms.id}-fee`,
            date: terms.feeDate,
            direction: "outflow",
            amount: terms.fee,
            description: "Fictional financing one-time fee",
          },
        });
      }
      const description = `${terms.lenderLabel} pays out ${formatBani(terms.principal)} on ${terms.disbursementDate}, charges a one-time fee of ${formatBani(terms.fee)} on ${terms.feeDate}, and is repaid ${formatBani(terms.principal)} on ${terms.repaymentDate}.`;
      return {
        ok: true,
        scenario: scenarioShell(dataset, delay, terms, adjustments, description, today),
        meta: {
          conditions: [
            `${terms.lenderLabel} approves and pays out ${formatBani(terms.principal)} on ${terms.disbursementDate}.`,
            `One-time fee of ${formatBani(terms.fee)} on ${terms.feeDate}.`,
            `Principal of ${formatBani(terms.principal)} repaid on ${terms.repaymentDate}.`,
            "No other charges in this fictional product.",
          ],
          costs: [
            { label: "One-time fee", amount: terms.fee, note: null },
            {
              label: "Interest and other charges",
              amount: bani(0),
              note: "None in this fictional product.",
            },
          ],
          approvals: [
            {
              party: terms.lenderLabel,
              kind: "bank_approval",
              description: "Bank approval required. This is not a real bank offer or approval.",
              status: "not_requested",
            },
          ],
          disclosures: [terms.disclaimer],
        },
      };
    }
  }
}

/** Evaluates every option independently against the same dataset version and delay scenario. */
export function compareRecoveryOptions(
  dataset: DemoDataset,
  delay: Scenario,
  termsList: readonly RecoveryTerms[],
  buffer: Bani,
  today: BusinessDate,
  /** Options the user reported as refused: option id → reason. They are not evaluated. */
  rejected: ReadonlyMap<string, string> = new Map(),
  /** Options already accepted (option id → note). Their effect is in `delay`; not re-evaluated. */
  accepted: ReadonlyMap<string, string> = new Map(),
): RecoveryComparison {
  const delayed = calculateScenarioCashFlow(dataset, delay, today).result;
  const horizonEnd = dataset.profile.horizon.end;

  const options: RecoveryOptionResult[] = termsList.map((terms) => {
    const acceptance = accepted.get(terms.id);
    if (acceptance !== undefined) {
      return {
        available: false,
        terms,
        reason: `Accepted: ${acceptance}`,
        rejected: false,
        accepted: true,
      };
    }
    const rejection = rejected.get(terms.id);
    if (rejection !== undefined) {
      return {
        available: false,
        terms,
        reason: `Rejected: ${rejection}`,
        rejected: true,
        accepted: false,
      };
    }
    const built = buildRecoveryScenario(dataset, delay, terms, today);
    if (!built.ok)
      return { available: false, terms, reason: built.reason, rejected: false, accepted: false };
    const forecast = calculateScenarioCashFlow(dataset, built.scenario, today);
    const outsideIds = new Set(forecast.outsideHorizon.map((e) => e.id));
    const outsideHorizon: OutsideHorizonItem[] = forecast.view.cashEvents
      .filter((e) => outsideIds.has(e.id))
      .map((e) => ({
        eventId: e.id,
        description: e.description,
        date: e.date,
        direction: e.direction,
        amount: e.amount,
      }));
    const outsideDisclosures = outsideHorizon.map((o) =>
      o.direction === "outflow"
        ? `Obligation outside the horizon: ${o.description} of ${formatBani(o.amount)} on ${o.date} is after ${horizonEnd} and not included. The ending cash shown does not reflect it.`
        : `Receipt outside the horizon: ${o.description} of ${formatBani(o.amount)} on ${o.date} is after ${horizonEnd} and not counted.`,
    );
    const min = forecast.result.minimumClosingBalance;
    return {
      available: true,
      terms,
      status: "hypothetical",
      scenario: built.scenario,
      result: forecast.result,
      ...built.meta,
      disclosures: [...built.meta.disclosures, ...outsideDisclosures],
      totalCost: bani(built.meta.costs.reduce((sum, c) => sum + c.amount, 0)),
      outsideHorizon,
      passesBuffer: min >= buffer,
      bufferGap: bani(Math.max(0, buffer - min)),
      resolvesShortfall: min >= 0,
    };
  });

  let finding: RecoveryFinding;
  if (delayed.minimumClosingBalance >= buffer) {
    finding = { kind: "delayed_case_meets_buffer" };
  } else {
    const evaluated = options.filter((o) => o.available);
    const passing = evaluated.filter((o) => o.passesBuffer).map((o) => o.terms.id);
    finding =
      passing.length > 0
        ? { kind: "options_meet_buffer", passing }
        : {
            kind: "all_fail",
            evaluated: evaluated.length,
            closestGap: evaluated.length
              ? bani(Math.min(...evaluated.map((o) => o.bufferGap)))
              : null,
          };
  }

  return {
    datasetVersion: dataset.datasetVersion,
    delayScenario: delay,
    buffer,
    delayed,
    options,
    finding,
  };
}
