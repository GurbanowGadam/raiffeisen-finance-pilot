/**
 * Synthetic recovery terms for the Bucharest Cafe demo (Step 7).
 *
 * These are labelled demo assumptions, not offers: no counterparty has agreed,
 * and the financing product is fictional. Values are integer bani.
 */
import { z } from "zod";

import { recoveryTermsSchema, type RecoveryTerms } from "@/domain";

export const BUCHAREST_CAFE_RECOVERY_TERMS: readonly RecoveryTerms[] = z
  .array(recoveryTermsSchema)
  .parse([
    {
      kind: "partial_collection",
      id: "recovery-partial-collection",
      letter: "A",
      title: "Partial collection",
      documentNumber: "CAT-001",
      partialAmount: 400_000,
      partialDate: "2026-11-09",
    },
    {
      kind: "supplier_deferral",
      id: "recovery-supplier-deferral",
      letter: "B",
      title: "Supplier deferral",
      documentNumber: "SUP-001",
      firstAmount: 400_000,
      firstDate: "2026-11-10",
      secondDate: "2026-11-20",
      fee: 0,
      feeAssumption:
        "Supplier fee assumed to be 0 RON for this labelled demo only; a real supplier may charge for deferral.",
    },
    {
      kind: "financing",
      id: "recovery-fictional-financing",
      letter: "C",
      title: "Fictional short-term financing",
      lenderLabel: "Fictional Lender (demo)",
      principal: 350_000,
      disbursementDate: "2026-11-09",
      fee: 10_000,
      feeDate: "2026-11-09",
      repaymentDate: "2026-11-20",
      disclaimer:
        "Fictional financing product for this demo. Not a real bank offer, rate, eligibility decision or approval.",
    },
  ]);
