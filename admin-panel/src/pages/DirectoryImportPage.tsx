import { useEffect, useMemo, useState, type CSSProperties, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Empty, ErrorBanner, Shell } from "../components/ui";
import { api, apiBlob, apiForm, setToken, type ApiError } from "../lib/api";
import { qs } from "../lib/dates";

type Kind = "farmers" | "vendors";

type Merchant = {
  shop_id: string;
  shop_name?: string;
  username?: string;
  active?: boolean;
};

type PreviewRow = {
  row_number: number;
  name: string;
  details?: string | null;
  status: "blank" | "invalid" | "duplicate" | "ready" | string;
  message?: string | null;
};

type PreviewOut = {
  shop_id: string;
  kind: Kind;
  summary: {
    total_rows: number;
    blank: number;
    invalid: number;
    duplicate: number;
    ready: number;
  };
  rows: PreviewRow[];
};

type ConfirmOut = {
  shop_id: string;
  kind: Kind;
  imported: number;
  skipped_duplicate: number;
  skipped_invalid: number;
  skipped_blank: number;
  errors: { row?: number; message?: string }[];
};

const PREVIEW_PAGE = 100;

export default function DirectoryImportPage() {
  const nav = useNavigate();
  const [kind, setKind] = useState<Kind>("farmers");
  const [shopQ, setShopQ] = useState("");
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [shopId, setShopId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewOut | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [result, setResult] = useState<ConfirmOut | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const selectedShop = useMemo(
    () => merchants.find((m) => m.shop_id === shopId) || null,
    [merchants, shopId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ items: Merchant[] }>(
          `/admin/merchants${qs({ q: shopQ, page: 1, page_size: 50 })}`,
        );
        if (!cancelled) setMerchants(res.items || []);
      } catch (err) {
        const e = err as ApiError;
        if (e.status === 401) {
          setToken(null);
          nav("/login");
          return;
        }
        if (!cancelled) setError(e.detail);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopQ, nav]);

  // Changing kind/shop/file clears prior preview/result (master-data; not working-date).
  useEffect(() => {
    setPreview(null);
    setResult(null);
    setConfirmOpen(false);
    setPreviewPage(0);
  }, [kind, shopId, file]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setError(null);
  };

  const downloadTemplate = async () => {
    setError(null);
    try {
      const blob = await apiBlob(`/admin/directory/import/template?kind=${kind}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = kind === "farmers" ? "farmer_directory_import.xlsx" : "vendor_directory_import.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        setToken(null);
        nav("/login");
        return;
      }
      setError(e.detail);
    }
  };

  const runPreview = async () => {
    setError(null);
    setResult(null);
    if (!shopId) {
      setError("Select a merchant shop first");
      return;
    }
    if (!file) {
      setError("Choose an .xlsx file to upload");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("shop_id", shopId);
      form.append("kind", kind);
      form.append("file", file);
      const res = await apiForm<PreviewOut>("/admin/directory/import/preview", form);
      setPreview(res);
      setPreviewPage(0);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        setToken(null);
        nav("/login");
        return;
      }
      setError(e.detail);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const readyRows = useMemo(
    () => (preview?.rows || []).filter((r) => r.status === "ready"),
    [preview],
  );

  const pagedPreview = useMemo(() => {
    if (!preview) return [];
    const start = previewPage * PREVIEW_PAGE;
    return preview.rows.slice(start, start + PREVIEW_PAGE);
  }, [preview, previewPage]);

  const previewPages = preview ? Math.max(1, Math.ceil(preview.rows.length / PREVIEW_PAGE)) : 1;

  const runImport = async () => {
    if (!preview || !shopId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ConfirmOut>("/admin/directory/import/confirm", {
        method: "POST",
        body: JSON.stringify({
          shop_id: shopId,
          kind,
          rows: readyRows.map((r) => ({
            name: r.name,
            details: kind === "vendors" ? r.details || "" : undefined,
          })),
        }),
      });
      setResult(res);
      setConfirmOpen(false);
      // Refresh preview statuses after import would require re-upload; keep result banner.
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        setToken(null);
        nav("/login");
        return;
      }
      setError(e.detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Directory Import"
      dateNote="Directory import ignores Working Date (master data)"
      actions={
        <button type="button" style={btnSecondary} onClick={downloadTemplate} data-testid="directory-template-download">
          Download {kind === "farmers" ? "Farmer" : "Vendor"} Excel format
        </button>
      }
    >
      <p style={hint}>
        Import Farmers or Vendors into a merchant&apos;s directory. This is master data — it does not use the Global
        Working Date and does not change Pattis, Vendor Bills, or purchases.
      </p>

      {error ? <ErrorBanner message={error} /> : null}

      <div style={card}>
        <div style={row}>
          <label style={label}>
            Type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              style={input}
              data-testid="directory-kind"
            >
              <option value="farmers">Farmers</option>
              <option value="vendors">Vendors</option>
            </select>
          </label>
          <label style={{ ...label, flex: 1.4 }}>
            Search merchant
            <input
              value={shopQ}
              onChange={(e) => setShopQ(e.target.value)}
              placeholder="Shop name / username"
              style={input}
              data-testid="directory-shop-search"
            />
          </label>
          <label style={{ ...label, flex: 1.6 }}>
            Merchant shop
            <select
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
              style={input}
              data-testid="directory-shop-select"
            >
              <option value="">Select shop…</option>
              {merchants.map((m) => (
                <option key={m.shop_id} value={m.shop_id}>
                  {(m.shop_name || m.shop_id) + (m.username ? ` (${m.username})` : "")}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ marginTop: 12, fontSize: 13, color: "#444" }}>
          Format:{" "}
          {kind === "farmers" ? (
            <strong>Column 1 = Farmer Name</strong>
          ) : (
            <strong>Column 1 = Vendor Name, Column 2 = Vendor Details</strong>
          )}
          {selectedShop ? (
            <>
              {" "}
              · Target: <strong>{selectedShop.shop_name || selectedShop.shop_id}</strong>
            </>
          ) : null}
        </div>

        <div style={{ ...row, marginTop: 14, alignItems: "flex-end" }}>
          <label style={{ ...label, flex: 2 }}>
            Excel file (.xlsx)
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFile}
              style={{ ...input, padding: 8 }}
              data-testid="directory-file"
            />
          </label>
          <button
            type="button"
            style={btnPrimary}
            disabled={busy}
            onClick={runPreview}
            data-testid="directory-preview"
          >
            {busy ? "Working…" : "Upload & Preview"}
          </button>
        </div>
      </div>

      {preview ? (
        <div style={{ ...card, marginTop: 16 }} data-testid="directory-preview-panel">
          <h2 style={h2}>Preview</h2>
          <div style={kpiRow}>
            <Kpi label="Total rows" value={preview.summary.total_rows} />
            <Kpi label="Ready to import" value={preview.summary.ready} />
            <Kpi label="Duplicates" value={preview.summary.duplicate} />
            <Kpi label="Blank (ignored)" value={preview.summary.blank} />
            <Kpi label="Invalid" value={preview.summary.invalid} />
          </div>

          {!preview.rows.length ? (
            <Empty message="No rows found in the Excel file." />
          ) : (
            <>
              <div style={tableWrap}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Row</th>
                      <th style={th}>Name</th>
                      {kind === "vendors" ? <th style={th}>Details</th> : null}
                      <th style={th}>Status</th>
                      <th style={th}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPreview.map((r) => (
                      <tr key={`${r.row_number}-${r.name}`}>
                        <td style={td}>{r.row_number}</td>
                        <td style={td}>{r.name || "—"}</td>
                        {kind === "vendors" ? <td style={td}>{r.details || "—"}</td> : null}
                        <td style={{ ...td, ...statusStyle(r.status) }}>{r.status}</td>
                        <td style={td}>{r.message || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                <button
                  type="button"
                  style={btnSecondary}
                  disabled={previewPage <= 0}
                  onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                >
                  Prev
                </button>
                <span style={{ fontSize: 13 }}>
                  Page {previewPage + 1} / {previewPages} (showing {PREVIEW_PAGE} at a time)
                </span>
                <button
                  type="button"
                  style={btnSecondary}
                  disabled={previewPage + 1 >= previewPages}
                  onClick={() => setPreviewPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              style={btnPrimary}
              disabled={busy || readyRows.length === 0}
              onClick={() => setConfirmOpen(true)}
              data-testid="directory-import-open-confirm"
            >
              Import {readyRows.length} ready {kind}
            </button>
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <div style={modalBackdrop} data-testid="directory-confirm-modal">
          <div style={modal}>
            <h3 style={{ margin: "0 0 8px" }}>Confirm import</h3>
            <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.45 }}>
              Import <strong>{readyRows.length}</strong> new {kind} into{" "}
              <strong>{selectedShop?.shop_name || shopId}</strong>? Duplicates and blank/invalid rows will be skipped.
              Existing Pattis and Vendor Bills are not changed.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={btnSecondary} disabled={busy} onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                style={btnPrimary}
                disabled={busy}
                onClick={runImport}
                data-testid="directory-import-confirm"
              >
                {busy ? "Importing…" : "Confirm import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {result ? (
        <div style={{ ...card, marginTop: 16, borderColor: "#166534" }} data-testid="directory-import-result">
          <h2 style={h2}>Import result</h2>
          <div style={kpiRow}>
            <Kpi label="Imported" value={result.imported} />
            <Kpi label="Skipped duplicates" value={result.skipped_duplicate} />
            <Kpi label="Skipped invalid" value={result.skipped_invalid} />
            <Kpi label="Skipped blank" value={result.skipped_blank} />
          </div>
          {result.errors?.length ? (
            <ul style={{ fontSize: 13, color: "#7f1d1d" }}>
              {result.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row ?? "?"}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Shell>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div style={kpi}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function statusStyle(status: string): CSSProperties {
  if (status === "ready") return { color: "#166534", fontWeight: 800 };
  if (status === "duplicate") return { color: "#92400e", fontWeight: 700 };
  if (status === "invalid") return { color: "#991b1b", fontWeight: 700 };
  return { color: "#6b7280" };
}

const hint: CSSProperties = { fontSize: 13, color: "#444", marginTop: 0, marginBottom: 14, maxWidth: 820, lineHeight: 1.45 };
const card: CSSProperties = { background: "#fff", border: "2px solid #111", padding: 16 };
const row: CSSProperties = { display: "flex", gap: 12, flexWrap: "wrap" };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, flex: 1, minWidth: 160 };
const input: CSSProperties = { border: "2px solid #111", padding: "8px 10px", fontSize: 14, fontWeight: 600, background: "#fff" };
const btnPrimary: CSSProperties = {
  background: "#111",
  color: "#fff",
  border: "2px solid #111",
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer",
  height: 42,
};
const btnSecondary: CSSProperties = {
  background: "#fff",
  color: "#111",
  border: "2px solid #111",
  padding: "8px 12px",
  fontWeight: 800,
  cursor: "pointer",
};
const h2: CSSProperties = { margin: "0 0 12px", fontSize: 18 };
const kpiRow: CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 };
const kpi: CSSProperties = { border: "2px solid #111", padding: "8px 12px", minWidth: 120, background: "#fafaf7" };
const tableWrap: CSSProperties = { maxHeight: 420, overflow: "auto", border: "1px solid #ddd" };
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: CSSProperties = { textAlign: "left", padding: 8, borderBottom: "2px solid #111", position: "sticky", top: 0, background: "#fff" };
const td: CSSProperties = { padding: 8, borderBottom: "1px solid #e5e5e5", verticalAlign: "top" };
const modalBackdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 80,
  padding: 16,
};
const modal: CSSProperties = { background: "#fff", border: "2px solid #111", padding: 20, maxWidth: 440, width: "100%" };
