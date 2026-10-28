/**
 * Double-counting guard shared by dataset integrity and the cash-flow calculation.
 *
 * A document number (invoice) may appear on more than one cash event only when
 * those events are the complete set of parts of one explicit split:
 * same `split.parentId`, same `split.count` equal to the number of events, and
 * indices 1..count. Amount conservation of a split is enforced where the split
 * is created (`applyScenario`).
 */

interface DocumentLinked {
  readonly id: string;
  readonly source?: { readonly documentNumber: string | null } | undefined;
  readonly split?:
    { readonly parentId: string; readonly index: number; readonly count: number } | undefined;
}

export function documentLinkIssues(events: readonly DocumentLinked[]): string[] {
  const groups = new Map<string, DocumentLinked[]>();
  for (const e of events) {
    const doc = e.source?.documentNumber ?? null;
    if (doc === null) continue;
    groups.set(doc, [...(groups.get(doc) ?? []), e]);
  }
  const issues: string[] = [];
  for (const [doc, group] of groups) {
    if (group.length < 2) continue;
    const first = group[0]!.split;
    const indices = new Set(group.map((e) => e.split?.index));
    const isCompleteSplit =
      first !== undefined &&
      group.every(
        (e) =>
          e.split !== undefined &&
          e.split.parentId === first.parentId &&
          e.split.count === first.count,
      ) &&
      first.count === group.length &&
      [...Array(group.length).keys()].every((i) => indices.has(i + 1));
    if (!isCompleteSplit) {
      issues.push(
        `Document "${doc}" is linked to more than one cash event (would be double-counted)`,
      );
    }
  }
  return issues;
}
