/**
 * Action drafts for recovery options: editable emails (partial collection, supplier
 * deferral) and a Markdown bank-meeting brief (fictional financing). Pure.
 *
 * Every amount and date in a draft is taken from the deterministic comparison and the
 * proposal's own adjustments, which are exactly what acceptance later applies.
 * Drafts are never sent.
 */
import { calculateScenarioCashFlow } from "./scenarios";
import type {
  ActionDraft,
  ActionDraftHistoryEntry,
  CashEvent,
  DemoDataset,
  Scenario,
  ScenarioAdjustment,
} from "./models";
import { formatBani, sumBani } from "./money";
import type { RecoveryComparison, RecoveryOptionResult } from "./recovery";
import type { Bani, BusinessDate } from "./types";

export type AvailableOption = Extract<RecoveryOptionResult, { available: true }>;

export interface DraftContext {
  readonly dataset: DemoDataset;
  /** Comparison computed on the active case (delay + accepted proposals). */
  readonly comparison: RecoveryComparison;
  readonly revision: number;
  readonly businessDate: BusinessDate;
  /** Wall-clock ISO timestamp for the audit entry. */
  readonly at: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "9 November 2026" from "2026-11-09". */
export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** FNV-1a 32-bit hash as hex. Not cryptographic; detects changed generated text. */
export function textFingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The option's own adjustments: what it changes on top of the active case. */
export function proposalAdjustments(option: AvailableOption, base: Scenario): ScenarioAdjustment[] {
  return option.scenario.adjustments.filter((a) => !base.adjustments.some((b) => same(a, b)));
}

function splitOf(proposal: readonly ScenarioAdjustment[]) {
  return proposal.find((a) => a.type === "split_event") as
    Extract<ScenarioAdjustment, { type: "split_event" }> | undefined;
}

function eventByDocument(dataset: DemoDataset, documentNumber: string): CashEvent | undefined {
  return dataset.cashEvents.find((e) => e.source.documentNumber === documentNumber);
}

/** First date after the first negative close where the balance is back at or above 0. */
function recoveryDateOf(comparison: RecoveryComparison): string | null {
  const r = comparison.delayed;
  if (!r.firstNegativeClosingDate) return null;
  const day = r.days.find((d) => d.date > r.firstNegativeClosingDate! && d.closingBalance >= 0);
  return day?.date ?? null;
}

const FOOTER = "[Draft prepared by Raiffeisen Finance Pilot for review. Not sent.]";

function emailBody(
  recipient: string,
  businessName: string,
  paragraphs: string[],
  bullets: string[],
  closing: string,
): string {
  return [
    `Dear ${recipient},`,
    "",
    ...paragraphs.flatMap((p) => [p, ""]).slice(0, -1),
    ...bullets.map((b) => `- ${b}`),
    "",
    closing,
    "",
    "Kind regards,",
    businessName,
    "",
    FOOTER,
  ].join("\n");
}

function optionLine(o: RecoveryOptionResult): string {
  if (!o.available) {
    return `- ${o.terms.letter}. ${o.terms.title}: ${o.accepted ? "already accepted" : o.rejected ? "rejected" : "not available"} (${o.reason}).`;
  }
  const approvals = o.approvals
    .map((a) => `${a.kind === "bank_approval" ? "bank approval" : "acceptance"} from ${a.party}`)
    .join(", ");
  return `- ${o.terms.letter}. ${o.terms.title}: lowest daily closing balance ${formatBani(o.result.minimumClosingBalance)} on ${o.result.minimumClosingDate}, ending ${formatBani(o.result.endingBalance)}, explicit cost ${formatBani(o.totalCost)}; ${o.passesBuffer ? "meets" : "fails"} the buffer; needs ${approvals}.`;
}

function bankBrief(option: AvailableOption, ctx: DraftContext): string {
  const { dataset, comparison, revision, businessDate } = ctx;
  const t = option.terms;
  if (t.kind !== "financing") throw new Error("bankBrief requires the financing option");
  const d = comparison.delayed;
  const recovery = recoveryDateOf(comparison);
  const view = calculateScenarioCashFlow(dataset, comparison.delayScenario, businessDate).view;
  const lastDate =
    t.repaymentDate > (recovery ?? "") ? t.repaymentDate : (recovery ?? t.repaymentDate);
  const inWindow = view.cashEvents.filter((e) => e.date <= lastDate);
  const sales = inWindow.filter((e) => e.category === "sales");
  const others = inWindow.filter((e) => e.category !== "sales");
  const ref = (e: CashEvent) => e.source.documentNumber ?? e.id;

  const lines = [
    "# Bank meeting brief: short-term financing (fictional product)",
    "",
    `Prepared by Raiffeisen Finance Pilot for ${dataset.profile.name} on ${businessDate} · dataset ${dataset.datasetVersion} · data revision ${revision}.`,
    "",
    "Synthetic demo data. This is a preparation note for a meeting. It is not a loan application, has not been sent, and is not an offer, rate, eligibility decision or approval.",
    "",
    "## The cash gap",
    "",
    `Without further action, the active case reaches its lowest daily closing balance of **${formatBani(d.minimumClosingBalance)}** on ${d.minimumClosingDate}.`,
    "",
    `- Opening balance (actual cash, start of ${dataset.profile.openingBalance.asOf}): ${formatBani(dataset.profile.openingBalance.amount)}`,
    `- First negative daily closing balance: ${d.firstNegativeClosingDate ?? "none in the horizon"}`,
    `- Back at or above 0 RON: ${recovery ?? (d.firstNegativeClosingDate ? "not within the horizon" : "not applicable")}`,
    `- Shortfall at the lowest point: ${formatBani(d.shortfall)}`,
    `- Ending balance on ${d.horizon.end}: ${formatBani(d.endingBalance)}`,
    `- Minimum daily cash buffer we plan for: ${formatBani(comparison.buffer)}`,
    "",
    "## What we would ask for",
    "",
    "| Item | Date | Amount |",
    "| --- | --- | --- |",
    `| Disbursement | ${t.disbursementDate} | ${formatBani(t.principal)} |`,
    `| One-time fee | ${t.feeDate} | ${formatBani(t.fee)} |`,
    `| Principal repayment | ${t.repaymentDate} | ${formatBani(t.principal)} |`,
    "",
    `With this financing the lowest daily closing balance would be **${formatBani(option.result.minimumClosingBalance)}** on ${option.result.minimumClosingDate}, and the ending balance **${formatBani(option.result.endingBalance)}**. This ${option.passesBuffer ? "meets" : "does not meet"} the ${formatBani(comparison.buffer)} buffer.`,
    "",
    `## Key dates and source data (to ${lastDate})`,
    "",
    "| Date | Event | Direction | Amount | Source |",
    "| --- | --- | --- | --- | --- |",
    ...others.map(
      (e) =>
        `| ${e.date} | ${e.description.replace(/\|/g, "/")} | ${e.direction} | ${formatBani(e.amount)} | ${ref(e)} |`,
    ),
    ...(sales.length
      ? [
          `| ${sales[0]!.date} to ${sales[sales.length - 1]!.date} | Forecast sales (${sales.length} events) | inflow | ${formatBani(sumBani(sales.map((s) => s.amount as Bani)))} | ${dataset.datasetVersion} |`,
        ]
      : []),
    "",
    `All events are forecasts from dataset ${dataset.datasetVersion}; none is an actual payment.`,
    "",
    "## Alternatives considered",
    "",
    ...comparison.options.filter((o) => o.terms.id !== t.id).map(optionLine),
    "",
    "## Assumptions",
    "",
    `- ${t.disclaimer}`,
    `- ${t.lenderLabel} is fictional. The fee of ${formatBani(t.fee)} is the only charge in this fictional product; no interest or other charges are modelled.`,
    ...option.disclosures.filter((x) => x !== t.disclaimer).map((x) => `- ${x}`),
    ...comparison.delayScenario.assumptions.map((a) => `- ${a.text}`),
    ...dataset.assumptions.map((a) => `- ${a.text}`),
    "- Balances are daily closing balances; intraday liquidity is not assessed.",
    "",
    FOOTER,
  ];
  return lines.join("\n");
}

function draftContent(option: AvailableOption, ctx: DraftContext, proposal: ScenarioAdjustment[]) {
  const { dataset } = ctx;
  const t = option.terms;
  const recipient = option.approvals[0]?.party ?? "Counterparty";
  const business = dataset.profile.name;
  if (t.kind === "partial_collection") {
    const split = splitOf(proposal);
    const event = eventByDocument(dataset, t.documentNumber);
    const [first, rest] = split?.parts ?? [];
    if (!split || !first || !rest || !event)
      throw new Error("Partial collection proposal is incomplete");
    return {
      kind: "customer_payment_reminder" as const,
      format: "email" as const,
      recipient,
      subject: `Request for an early part-payment of invoice ${t.documentNumber}`,
      body: emailBody(
        recipient,
        business,
        [
          `We are reviewing our cash plan for ${longDate(first.date).split(" ").slice(1).join(" ")}. Regarding invoice ${t.documentNumber} for ${formatBani(event.amount)}, would you be able to pay part of it earlier, as follows?`,
        ],
        [
          `${formatBani(first.amount)} by ${longDate(first.date)} (${first.date})`,
          `the remaining ${formatBani(rest.amount)} expected on ${longDate(rest.date)} (${rest.date})`,
        ],
        `The invoice total stays ${formatBani(event.amount)}. Please let us know whether this works for you.`,
      ),
    };
  }
  if (t.kind === "supplier_deferral") {
    const split = splitOf(proposal);
    const event = eventByDocument(dataset, t.documentNumber);
    const [first, rest] = split?.parts ?? [];
    if (!split || !first || !rest || !event)
      throw new Error("Supplier deferral proposal is incomplete");
    return {
      kind: "supplier_payment_extension" as const,
      format: "email" as const,
      recipient,
      subject: `Request to split payment of invoice ${t.documentNumber}`,
      body: emailBody(
        recipient,
        business,
        [
          `To manage a temporary cash gap, we would like to propose paying invoice ${t.documentNumber} (${formatBani(event.amount)}) in two parts:`,
        ],
        [
          `${formatBani(first.amount)} on ${longDate(first.date)} (${first.date})`,
          `the remaining ${formatBani(rest.amount)} on ${longDate(rest.date)} (${rest.date})`,
          `total payment unchanged at ${formatBani(event.amount)}`,
        ],
        "Please let us know whether this works for you and whether any fee would apply.",
      ),
    };
  }
  return {
    kind: "financing_inquiry" as const,
    format: "brief" as const,
    recipient,
    subject: `Bank meeting brief: ${formatBani(t.principal)} short-term financing (fictional)`,
    body: bankBrief(option, ctx),
  };
}

/** Builds a fresh draft (status `draft`) for one available option. */
export function buildActionDraft(option: AvailableOption, ctx: DraftContext): ActionDraft {
  const proposal = proposalAdjustments(option, ctx.comparison.delayScenario);
  const content = draftContent(option, ctx, proposal);
  const entry: ActionDraftHistoryEntry = {
    event: "generated",
    status: "draft",
    at: ctx.at,
    businessDate: ctx.businessDate,
    revision: ctx.revision,
  };
  return {
    id: `act-${option.terms.id}`,
    kind: content.kind,
    format: content.format,
    optionId: option.terms.id,
    scenarioId: option.scenario.id,
    recipientLabel: content.recipient,
    subject: content.subject,
    body: content.body,
    status: "draft",
    createdOn: ctx.businessDate,
    sources: [
      { kind: "scenario", id: option.scenario.id, documentNumber: null },
      ...option.scenario.sources,
    ],
    basis: {
      datasetVersion: ctx.dataset.datasetVersion,
      revision: ctx.revision,
      proposal,
      fingerprint: textFingerprint(`${content.subject}\n${content.body}`),
    },
    edited: false,
    history: [entry],
  };
}

/** Replaces a draft's content with a fresh one, keeping its audit history. */
export function regenerateDraft(
  existing: ActionDraft | undefined,
  fresh: ActionDraft,
): ActionDraft {
  if (!existing) return fresh;
  return {
    ...fresh,
    history: [...existing.history, { ...fresh.history[0]!, event: "regenerated" }],
  };
}

/** Same generated content and basis (ignores history, timestamps and revision). */
export function sameDraftContent(a: ActionDraft, b: ActionDraft): boolean {
  return (
    a.subject === b.subject &&
    a.body === b.body &&
    a.recipientLabel === b.recipientLabel &&
    a.basis.datasetVersion === b.basis.datasetVersion &&
    same(a.basis.proposal, b.basis.proposal) &&
    a.basis.fingerprint === b.basis.fingerprint
  );
}

export type DraftFreshness =
  | { readonly kind: "settled" }
  | { readonly kind: "dataset_changed"; readonly reason: string }
  | { readonly kind: "outdated"; readonly reason: string }
  /** `rechecked`: the data revision moved on, but the proposal is still exactly the same. */
  | { readonly kind: "current"; readonly rechecked: boolean };

/**
 * Whether a draft still matches the active data. A draft is outdated when the proposal it
 * would make today differs (dates, amounts, availability), or when any figure its generated
 * text quotes has changed (e.g. the gap or the alternatives in a bank brief).
 */
export function draftFreshness(
  draft: ActionDraft,
  comparison: RecoveryComparison | null,
  dataset: DemoDataset,
  revision: number,
  businessDate: BusinessDate,
): DraftFreshness {
  const datasetVersion = dataset.datasetVersion;
  if (draft.status === "accepted" || draft.status === "rejected") return { kind: "settled" };
  if (draft.basis.datasetVersion !== datasetVersion) {
    return {
      kind: "dataset_changed",
      reason: `This draft was prepared for dataset ${draft.basis.datasetVersion}; the active dataset is ${datasetVersion}. Prepare a new draft.`,
    };
  }
  if (!comparison) {
    return {
      kind: "outdated",
      reason: "No payment delay is active, so this proposal no longer applies to the active case.",
    };
  }
  const option = comparison.options.find((o) => o.terms.id === draft.optionId);
  if (!option) return { kind: "outdated", reason: "This recovery option no longer exists." };
  if (!option.available) return { kind: "outdated", reason: option.reason };
  if (!same(proposalAdjustments(option, comparison.delayScenario), draft.basis.proposal)) {
    return {
      kind: "outdated",
      reason: `The data changed after this draft was prepared (revision ${draft.basis.revision}, now ${revision}); its dates or amounts no longer match. Regenerate it.`,
    };
  }
  // Regenerate at the draft's own revision so only real figure changes count.
  const regenerated = buildActionDraft(option, {
    dataset,
    comparison,
    revision: draft.basis.revision,
    businessDate,
    at: draft.history[0]!.at,
  });
  if (regenerated.basis.fingerprint !== draft.basis.fingerprint) {
    return {
      kind: "outdated",
      reason: `Figures quoted in this draft changed after it was prepared (revision ${draft.basis.revision}, now ${revision}), for example the cash gap, the buffer or the alternatives. Regenerate it.`,
    };
  }
  return { kind: "current", rechecked: draft.basis.revision !== revision };
}

/** Plain-text rendering of a Markdown brief (headings, bold, tables). */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !/^\|\s*-{3}/.test(line))
    .map((line) => {
      const heading = /^(#+)\s+(.*)$/.exec(line);
      if (heading) {
        const text = heading[2]!;
        return heading[1]!.length === 1
          ? text.toUpperCase()
          : `${text}\n${"-".repeat(text.length)}`;
      }
      if (line.startsWith("|")) {
        return line
          .replace(/^\|\s*/, "")
          .replace(/\s*\|$/, "")
          .split(/\s*\|\s*/)
          .join("  |  ");
      }
      return line;
    })
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "$1");
}
