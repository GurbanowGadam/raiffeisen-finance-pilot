import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import { parseImportRows, TEMPLATE_CSV, type ImportResult } from "@/biz/model";
import { shortDate, useBiz } from "@/biz/store";
import { Amount, Card, PageTitle } from "@/biz/ui";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload financial data — Raiffeisen Business AI" },
      { name: "description", content: "Import expected income and expenses from CSV or Excel files." },
      { property: "og:title", content: "Upload data — Raiffeisen Business AI" },
      { property: "og:description", content: "CSV and Excel import with preview." },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const { addMany } = useBiz();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [res, setRes] = useState<ImportResult | null>(null);

  async function onFile(file: File) {
    setName(file.name);
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0] ?? ""]!;
    setRes(parseImportRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true })));
  }
  function template(kind: "csv" | "xlsx") {
    if (kind === "csv") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
      a.download = "raiffeisen-business-ai-template.csv";
      a.click();
    } else {
      const wb = XLSX.read(TEMPLATE_CSV, { type: "string", raw: true });
      XLSX.writeFile(wb, "raiffeisen-business-ai-template.xlsx");
    }
  }
  const step = !res ? 1 : res.rows.length ? 3 : 2;

  return (
    <>
      <PageTitle title="Upload financial data" sub="Columns: date, type (income/expense), category, description, amount, status, recurrence."
        right={<div className="flex gap-2"><Button variant="outline" onClick={() => template("csv")}><Download className="h-4 w-4" /> CSV template</Button><Button variant="outline" onClick={() => template("xlsx")}><Download className="h-4 w-4" /> Excel template</Button></div>} />
      <ol className="mb-6 flex flex-wrap gap-2 text-xs">
        {["Select file", "Validate", "Preview", "Confirm import", "Forecast updated"].map((s, i) => (
          <li key={s} className={`rounded-full px-3 py-1 ${i < step ? "bg-primary font-semibold text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}. {s}</li>
        ))}
      </ol>
      <Card>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-10 hover:bg-muted">
          <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm font-medium">{name || "Choose a .csv, .xlsx or .xls file"}</span>
          <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </Card>
      {res && (
        <Card className="mt-6">
          {res.errors.length > 0 && (
            <div className="mb-4 rounded-lg border border-expense-border bg-expense-soft p-3 text-sm">
              <p className="font-semibold text-expense">{res.errors.length} row(s) skipped</p>
              <ul className="mt-1 list-disc pl-5 text-xs">{res.errors.slice(0, 10).map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          <h2 className="mb-2 font-semibold">Preview — {res.rows.length} valid transaction(s)</h2>
          <table className="w-full text-sm"><tbody>{res.rows.map((r) => (
            <tr key={r.id} className="border-t border-border"><td className="py-2">{shortDate(r.date)}</td><td>{r.description}</td><td className="text-muted-foreground">{r.category}</td><td className="text-right"><Amount type={r.type} amount={r.amount} /></td></tr>))}</tbody></table>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setRes(null); setName(""); }}>Cancel</Button>
            <Button disabled={!res.rows.length} onClick={() => { addMany(res.rows); nav({ to: "/" }); }}>Confirm import & recalculate</Button>
          </div>
        </Card>
      )}
    </>
  );
}
