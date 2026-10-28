/**
 * Primitive branded types shared across the Raiffeisen Finance Pilot domain.
 *
 * Validated models (BusinessProfile, CashEvent, Receivable, Scenario,
 * ActionDraft, AgentRun, DemoDataset) live in `./models.ts`.
 * This file must not import UI, network, storage or AI code.
 */

/** Integer amount of bani (100 bani = 1 RON). Never a float. */
export type Bani = number & { readonly __unit: "bani" };

/** Business date in `YYYY-MM-DD` format, with no time or timezone. */
export type BusinessDate = string & { readonly __format: "YYYY-MM-DD" };
