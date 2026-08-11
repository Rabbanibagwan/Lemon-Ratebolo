import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable, ScrollView, Share,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";

import { api, LotReportRow, Patti, ReportRow } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, font, money, spacing } from "@/src/theme";
import { Empty } from "@/src/components/ui";

type Mode = "farmer" | "vendor" | "lot" | "driver";

type DriverSettlement = {
  driver_name: string;
  place: string | null;
  date: string;
  total_bags: number;
  total_pattis: number;
  pattis_to_driver: number;
  pattis_to_farmer: number;
  driver_payable_total: number;
  rows: {
    patti_id: string; patti_no: number; farmer_name: string; lot_nos: string[];
    bags: number; net_payable: number; receiver_name: string; taken_by: "Driver" | "Farmer";
  }[];
};

export default function Reports() {
  const { session } = useAuth();
  const [mode, setMode] = useState<Mode>("farmer");
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [lots, setLots] = useState<LotReportRow[] | null>(null);
  const [drivers, setDrivers] = useState<DriverSettlement[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      if (mode === "lot") setLots(await api.get<LotReportRow[]>("/reports/by-lot"));
      else if (mode === "driver") setDrivers(await api.get<DriverSettlement[]>("/reports/driver-settlement"));
      else setRows(await api.get<ReportRow[]>(mode === "farmer" ? "/reports/by-farmer" : "/reports/by-vendor"));
    } catch { setRows([]); setLots([]); setDrivers([]); }
    finally { setLoading(false); }
  }, [mode]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exportFarmerSummaryPdf = async () => {
    try {
      setExporting(true);
      const pattis = await api.get<Patti[]>("/pattis");
      const html = renderFarmerSummaryHtml(pattis, session?.shop_name || "", session?.display_name || "");
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: ".pdf", dialogTitle: "Farmer Summary Report" });
      } else if (Platform.OS !== "web") {
        await Share.share({ url: uri });
      } else {
        Alert.alert("PDF generated", uri);
      }
    } catch (e: any) {
      Alert.alert("Failed", e?.detail || "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const exportDriverPdf = async (d: DriverSettlement) => {
    try {
      const html = renderDriverPdf(d, session?.shop_name || "", session?.display_name || "");
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: ".pdf", dialogTitle: `Driver ${d.driver_name} Settlement` });
      } else if (Platform.OS !== "web") await Share.share({ url: uri });
      else Alert.alert("PDF generated", uri);
    } catch (e: any) { Alert.alert("Failed", e?.detail || "Could not export"); }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>REPORTS</Text>
          <Text style={styles.subtitle}>All time</Text>
        </View>
        {mode === "farmer" && (
          <Pressable style={styles.pdfBtn} onPress={exportFarmerSummaryPdf} disabled={exporting} testID="export-farmer-pdf">
            <Ionicons name="download-outline" size={14} color={colors.onSurfaceInverse} />
            <Text style={styles.pdfBtnText}>{exporting ? "…" : "PDF"}</Text>
          </Pressable>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segRow} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 0 }}>
        <Seg label="FARMERS" active={mode === "farmer"} onPress={() => setMode("farmer")} testID="report-seg-farmer" />
        <Seg label="VENDORS" active={mode === "vendor"} onPress={() => setMode("vendor")} testID="report-seg-vendor" />
        <Seg label="LOTS" active={mode === "lot"} onPress={() => setMode("lot")} testID="report-seg-lot" />
        <Seg label="DRIVER TODAY" active={mode === "driver"} onPress={() => setMode("driver")} testID="report-seg-driver" />
      </ScrollView>

      {loading && !rows && !lots && !drivers ? (
        <View style={{ padding: spacing.xxl, alignItems: "center" }}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : mode === "driver" ? (
        <FlatList
          data={drivers || []}
          keyExtractor={(x) => x.driver_name}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 100 }}
          ListEmptyComponent={
            loading ? null : <Empty title="No drivers today" subtitle="Set up drivers in the Auction Book and add lots." testID="drivers-empty" />
          }
          renderItem={({ item }) => (
            <View style={styles.driverCard}>
              <View style={styles.driverHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverName}>{item.driver_name}</Text>
                  <Text style={styles.driverSub}>{item.place || "—"} · {item.date}</Text>
                </View>
                <Pressable style={styles.driverPdf} onPress={() => exportDriverPdf(item)} testID={`driver-pdf-${item.driver_name}`}>
                  <Ionicons name="download-outline" size={14} color={colors.onSurfaceInverse} />
                  <Text style={styles.driverPdfText}>PDF</Text>
                </Pressable>
              </View>

              <View style={styles.driverStats}>
                <MiniStat label="BAGS" value={String(item.total_bags)} />
                <MiniStat label="PATTIS" value={String(item.total_pattis)} />
                <MiniStat label="→ DRIVER" value={String(item.pattis_to_driver)} />
                <MiniStat label="→ FARMER" value={String(item.pattis_to_farmer)} />
              </View>

              {item.rows.map((r) => (
                <View key={r.patti_id} style={styles.dRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dFarmer}>{r.farmer_name}</Text>
                    <Text style={styles.dMeta}>#{r.patti_no} · {r.lot_nos.join(", ")} · {r.bags}b</Text>
                    <Text style={styles.dMeta}>
                      Receiver: {r.receiver_name || "—"} · <Text style={{ fontWeight: "900", color: r.taken_by === "Driver" ? colors.brandPrimary : colors.error }}>{r.taken_by}</Text>
                    </Text>
                  </View>
                  <Text style={[styles.dAmt, r.taken_by === "Farmer" && styles.strike]}>
                    {money(r.net_payable)}
                  </Text>
                </View>
              ))}

              <View style={styles.driverTotalRow}>
                <Text style={styles.driverTotalLabel}>DRIVER PAYABLE</Text>
                <Text style={styles.driverTotalValue}>{money(item.driver_payable_total)}</Text>
              </View>
            </View>
          )}
        />
      ) : mode === "lot" ? (
        <FlatList
          data={lots || []}
          keyExtractor={(x, i) => `${x.lot_no}-${i}`}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100 }}
          ListEmptyComponent={loading ? null : <Empty title="No data yet" subtitle="Add lots in Auction Book" testID="reports-empty" />}
          ListHeaderComponent={
            lots && lots.length ? (
              <View style={styles.thRow}>
                <Text style={[styles.th, { flex: 0.8 }]}>LOT</Text>
                <Text style={[styles.th, { flex: 1.4 }]}>FARMER</Text>
                <Text style={[styles.th, { flex: 0.6, textAlign: "right" }]}>BAGS</Text>
                <Text style={[styles.th, { flex: 1.1, textAlign: "right" }]}>GROSS</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 0.8 }}>
                <Text style={styles.lotNo}>{item.lot_no}</Text>
                <Text style={styles.small}>{item.driver_name || "—"}</Text>
              </View>
              <View style={{ flex: 1.4 }}>
                <Text style={styles.cellDim}>{item.farmer_name}</Text>
                <Text style={styles.small}>{item.date}</Text>
              </View>
              <Text style={[styles.mono, { flex: 0.6, textAlign: "right" }]}>{item.bags}</Text>
              <Text style={[styles.mono, styles.strong, { flex: 1.1, textAlign: "right" }]}>{money(item.gross)}</Text>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={rows || []}
          keyExtractor={(x) => x.key}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100 }}
          ListEmptyComponent={loading ? null : <Empty title="No data yet" subtitle="Generate a Patti to see reports" testID="reports-empty" />}
          ListHeaderComponent={
            rows && rows.length ? (
              <View style={styles.thRow}>
                <Text style={[styles.th, { flex: 2 }]}>{mode === "farmer" ? "FARMER" : "VENDOR"}</Text>
                <Text style={[styles.th, { flex: 0.7, textAlign: "right" }]}>BAGS</Text>
                <Text style={[styles.th, { flex: 1.3, textAlign: "right" }]}>{mode === "farmer" ? "NET" : "GROSS"}</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 2 }}>
                <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
                <Text style={styles.small}>{item.pattis} patti{item.pattis === 1 ? "" : "s"}</Text>
              </View>
              <Text style={[styles.mono, { flex: 0.7, textAlign: "right" }]}>{item.bags}</Text>
              <Text style={[styles.mono, styles.strong, { flex: 1.3, textAlign: "right", color: colors.brandPrimary }]}>
                {money(mode === "farmer" ? item.net : item.gross)}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Seg({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} style={[styles.seg, active && styles.segActive]} onPress={onPress}>
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

// ---------- HTML report renderers ----------
function fmt(n: number) { return "₹" + (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s: string) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)); }

function renderDriverPdf(d: DriverSettlement, shopName: string, userName: string) {
  const rows = d.rows.map((r) => `
    <tr>
      <td>${esc(r.farmer_name)}</td>
      <td class="mono">${esc(r.lot_nos.join(", "))}</td>
      <td class="mono right">${r.bags}</td>
      <td class="mono right ${r.taken_by === "Farmer" ? "strike" : "strong"}">${fmt(r.net_payable)}</td>
      <td class="tag ${r.taken_by === "Driver" ? "tagGreen" : "tagRed"}">${r.taken_by}</td>
    </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    @page { margin: 20px; size: A4; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:#111827; }
    h1 { margin: 0 0 4px; font-size: 22px; letter-spacing:-0.5px; }
    .sub { color:#6B7280; font-size:12px; margin-bottom: 12px; }
    .card { border:2px solid #111827; padding: 14px; }
    table { width:100%; border-collapse: collapse; }
    thead th { text-align:left; font-size:10px; letter-spacing:1px; color:#6B7280; padding: 6px 4px; border-bottom:2px solid #111827; text-transform:uppercase; font-weight:800; }
    tbody td { padding: 6px 4px; border-bottom:1px dashed #D1D5DB; font-size: 12px; }
    .right { text-align: right; } .strong { font-weight: 800; } .mono { font-family: Menlo, monospace; }
    .strike { text-decoration: line-through; color: #6B7280; }
    .tag { font-size:10px; font-weight:800; letter-spacing:1px; text-align:center; padding: 2px 6px; }
    .tagGreen { background:#DCFCE7; color:#166534; }
    .tagRed { background:#FEE2E2; color:#DC2626; }
    .totals { margin-top: 10px; }
    .trow { display:flex; justify-content:space-between; padding: 3px 0; font-size:12px; }
    .net { background:#111827; color:#fff; padding: 10px 12px; display:flex; justify-content:space-between; align-items:center; margin-top:6px; }
    .netl { font-size:12px; font-weight:900; letter-spacing:1.5px; }
    .netv { font-family: Menlo, monospace; font-weight:900; font-size:20px; }
    .foot { margin-top: 14px; font-size:10px; color:#6B7280; text-align:center; }
  </style></head><body>
  <h1>${esc(shopName.toUpperCase())} — DRIVER SETTLEMENT</h1>
  <div class="sub">Driver: <b>${esc(d.driver_name)}</b>${d.place ? " · " + esc(d.place) : ""} · Date ${d.date}</div>
  <div class="card">
    <table>
      <thead><tr><th>FARMER</th><th>LOTS</th><th class="right">BAGS</th><th class="right">NET</th><th>TAKEN BY</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" style="text-align:center;color:#6B7280;padding:14px">No pattis for this driver</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div class="trow"><span>Total bags</span><span class="mono strong">${d.total_bags}</span></div>
      <div class="trow"><span>Total pattis</span><span class="mono strong">${d.total_pattis}</span></div>
      <div class="trow"><span>Pattis to driver</span><span class="mono">${d.pattis_to_driver}</span></div>
      <div class="trow"><span>Already taken by farmer (excluded)</span><span class="mono">${d.pattis_to_farmer}</span></div>
    </div>
    <div class="net"><div class="netl">DRIVER PAYABLE TOTAL</div><div class="netv">${fmt(d.driver_payable_total)}</div></div>
  </div>
  <div class="foot">Generated by ${esc(userName)} · ${new Date().toLocaleString("en-IN")}</div>
  </body></html>`;
}

function renderFarmerSummaryHtml(pattis: Patti[], shopName: string, userName: string) {
  // group by farmer
  const byFarmer: Record<string, Patti[]> = {};
  for (const p of pattis) {
    if ((p as any).deleted) continue;
    if (!byFarmer[p.farmer_id]) byFarmer[p.farmer_id] = [];
    byFarmer[p.farmer_id].push(p);
  }
  const farmerBlocks = Object.values(byFarmer).map((ps) => {
    const f = ps[0];
    const totals = ps.reduce(
      (a, p) => ({
        bags: a.bags + p.total_bags,
        gross: a.gross + p.gross_total,
        farmer_gross: a.farmer_gross + p.farmer_gross,
        hamali: a.hamali + p.hamali_total,
        bhada: a.bhada + p.bhada_total,
        stat: a.stat + p.stationery_total,
        deductions: a.deductions + p.deductions_total,
        net: a.net + p.net_payable,
      }),
      { bags: 0, gross: 0, farmer_gross: 0, hamali: 0, bhada: 0, stat: 0, deductions: 0, net: 0 },
    );
    const lotsHtml = ps.map((p) => p.lots.map((l) => `
      <tr>
        <td class="mono">${esc(l.lot_no)}</td>
        <td class="mono">#${p.patti_no}</td>
        <td class="mono right">${l.total_bags}</td>
        <td class="mono right">${fmt(l.bhada_per_bag)}</td>
        <td class="mono right strong">${fmt(l.farmer_amount)}</td>
      </tr>`).join("")).join("");
    return `
    <div class="fCard">
      <div class="fHead">
        <div><div class="fName">${esc(f.farmer_name)}</div><div class="fSub">Driver: ${esc(f.driver_name || "—")}${f.driver_place ? " · " + esc(f.driver_place) : ""}</div></div>
        <div class="fTotals">${ps.length} patti${ps.length === 1 ? "" : "s"} · ${totals.bags} bags</div>
      </div>
      <table>
        <thead><tr><th>LOT</th><th>PATTI</th><th class="right">BAGS</th><th class="right">BHADA/BAG</th><th class="right">FARMER AMT</th></tr></thead>
        <tbody>${lotsHtml}</tbody>
      </table>
      <div class="trow"><span>Gross</span><span class="mono strong">${fmt(totals.gross)}</span></div>
      <div class="trow"><span>Farmer gross</span><span class="mono strong">${fmt(totals.farmer_gross)}</span></div>
      <div class="trow"><span>Hamali</span><span class="mono">− ${fmt(totals.hamali)}</span></div>
      <div class="trow"><span>Bhada</span><span class="mono">− ${fmt(totals.bhada)}</span></div>
      <div class="trow"><span>Stationery</span><span class="mono">− ${fmt(totals.stat)}</span></div>
      <div class="net"><div class="netl">NET PAYABLE</div><div class="netv">${fmt(totals.net)}</div></div>
    </div>`;
  }).join("");

  const grand = pattis
    .filter((p) => !(p as any).deleted)
    .reduce(
      (a, p) => ({
        pattis: a.pattis + 1,
        bags: a.bags + p.total_bags,
        gross: a.gross + p.gross_total,
        hamali: a.hamali + p.hamali_total,
        bhada: a.bhada + p.bhada_total,
        stat: a.stat + p.stationery_total,
        deductions: a.deductions + p.deductions_total,
        net: a.net + p.net_payable,
      }),
      { pattis: 0, bags: 0, gross: 0, hamali: 0, bhada: 0, stat: 0, deductions: 0, net: 0 },
    );

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <style>
    @page { margin: 18px; size: A4; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color:#111827; }
    h1 { margin: 0; font-size: 22px; letter-spacing:-0.5px; }
    .sub { color:#6B7280; font-size:12px; margin: 2px 0 12px; }
    .fCard { border:2px solid #111827; padding: 12px; margin-bottom: 12px; }
    .fHead { display:flex; justify-content: space-between; align-items:flex-start; border-bottom:2px solid #111827; padding-bottom: 6px; margin-bottom: 8px; }
    .fName { font-size:16px; font-weight:900; }
    .fSub { color:#6B7280; font-size:11px; }
    .fTotals { font-family: Menlo, monospace; font-weight:800; font-size:12px; }
    table { width:100%; border-collapse: collapse; }
    thead th { text-align:left; font-size:9px; letter-spacing:1px; color:#6B7280; padding: 4px 2px; border-bottom:2px solid #111827; text-transform:uppercase; font-weight:800; }
    tbody td { padding: 4px 2px; border-bottom:1px dashed #D1D5DB; font-size: 11px; }
    .right { text-align: right; } .strong { font-weight: 800; } .mono { font-family: Menlo, monospace; }
    .trow { display:flex; justify-content:space-between; padding: 2px 0; font-size:11px; }
    .net { background:#111827; color:#fff; padding: 8px 10px; display:flex; justify-content:space-between; align-items:center; margin-top:6px; }
    .netl { font-size:11px; font-weight:900; letter-spacing:1.5px; }
    .netv { font-family: Menlo, monospace; font-weight:900; font-size:18px; }
    .grand { border:2px solid #111827; padding: 12px; background:#F3F4F6; margin-top: 12px; }
    .foot { margin-top: 12px; font-size:10px; color:#6B7280; text-align:center; }
  </style></head><body>
    <h1>${esc(shopName.toUpperCase())} — FARMER SUMMARY</h1>
    <div class="sub">Generated ${new Date().toLocaleString("en-IN")} · All pattis (excluding deleted)</div>
    ${farmerBlocks || `<div class="fCard"><div style="text-align:center;color:#6B7280;padding:16px">No pattis yet</div></div>`}
    <div class="grand">
      <div style="font-size:12px;font-weight:900;letter-spacing:1.5px;margin-bottom:6px">GRAND TOTAL</div>
      <div class="trow"><span>Total pattis</span><span class="mono strong">${grand.pattis}</span></div>
      <div class="trow"><span>Total bags</span><span class="mono strong">${grand.bags}</span></div>
      <div class="trow"><span>Gross amount</span><span class="mono">${fmt(grand.gross)}</span></div>
      <div class="trow"><span>Total hamali</span><span class="mono">${fmt(grand.hamali)}</span></div>
      <div class="trow"><span>Total bhada</span><span class="mono">${fmt(grand.bhada)}</span></div>
      <div class="trow"><span>Total stationery</span><span class="mono">${fmt(grand.stat)}</span></div>
      <div class="trow"><span>Total deductions</span><span class="mono">${fmt(grand.deductions)}</span></div>
      <div class="net"><div class="netl">GRAND NET PAYABLE</div><div class="netv">${fmt(grand.net)}</div></div>
    </div>
    <div class="foot">Generated by ${esc(userName)} · ${new Date().toLocaleString("en-IN")}</div>
  </body></html>`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
    flexDirection: "row", alignItems: "flex-end", gap: spacing.md,
  },
  title: { fontSize: 28, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: colors.muted, fontFamily: font.mono, fontWeight: "700" },
  pdfBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.surfaceInverse, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 2, borderColor: colors.surfaceInverse,
  },
  pdfBtnText: { color: colors.onSurfaceInverse, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 11 },

  segRow: { maxHeight: 46, marginTop: spacing.md, flexGrow: 0 },
  seg: { paddingVertical: 8, paddingHorizontal: 14, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, marginRight: -2, minHeight: 36, flexShrink: 0 },
  segActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  segText: { fontFamily: font.display, fontWeight: "800", letterSpacing: 1, color: colors.onSurface, fontSize: 11 },
  segTextActive: { color: colors.onSurfaceInverse },

  thRow: { flexDirection: "row", borderBottomWidth: 2, borderColor: colors.borderStrong, paddingBottom: 8 },
  th: { fontSize: 10, letterSpacing: 1, fontFamily: font.display, fontWeight: "800", color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface },
  label: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  cellDim: { fontSize: 14, fontWeight: "700", color: colors.onSurface, fontFamily: font.display },
  lotNo: { fontSize: 14, fontWeight: "800", color: colors.onSurface, fontFamily: font.mono },
  small: { fontSize: 11, color: colors.muted, fontFamily: font.display, marginTop: 2 },
  mono: { fontSize: 14, color: colors.onSurface, fontFamily: font.mono },
  strong: { fontWeight: "800" },

  driverCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface, gap: spacing.sm },
  driverHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 2, borderColor: colors.borderStrong, paddingBottom: spacing.sm },
  driverName: { fontSize: 18, fontWeight: "900", color: colors.onSurface, fontFamily: font.display },
  driverSub: { fontSize: 11, color: colors.muted, fontFamily: font.display, marginTop: 2 },
  driverPdf: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.surfaceInverse, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 2, borderColor: colors.surfaceInverse,
  },
  driverPdfText: { color: colors.onSurfaceInverse, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 11 },
  driverStats: { flexDirection: "row", gap: 6 },
  miniStat: { flex: 1, alignItems: "center", padding: 6, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary },
  miniStatValue: { fontFamily: font.mono, fontWeight: "800", fontSize: 16, color: colors.onSurface },
  miniStatLabel: { fontSize: 9, letterSpacing: 1, color: colors.muted, fontFamily: font.display, fontWeight: "800", marginTop: 2 },

  dRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: 8,
  },
  dFarmer: { fontSize: 14, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  dMeta: { fontSize: 11, color: colors.muted, fontFamily: font.display, marginTop: 1 },
  dAmt: { fontSize: 15, fontFamily: font.mono, fontWeight: "800", color: colors.onSurface },
  strike: { textDecorationLine: "line-through", color: colors.muted },

  driverTotalRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.surfaceInverse, padding: spacing.md, marginTop: spacing.sm,
  },
  driverTotalLabel: { color: colors.onSurfaceInverse, fontFamily: font.display, fontWeight: "900", letterSpacing: 1.5, fontSize: 12 },
  driverTotalValue: { color: colors.onSurfaceInverse, fontFamily: font.mono, fontWeight: "900", fontSize: 20 },
});
