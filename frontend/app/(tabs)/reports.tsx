import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
  DriverRangeRef,
  DriverSummary,
  auditReportAoa,
  driverDetailTotals,
  exportPdfBytes,
  farmerReportAoa,
  farmerTotals,
  groupDrivers,
  isPattiReceived,
  lotLabel,
  receiverDisplay,
  shareXlsx,
  thermalPrintDriverReport,
  shareDriverThermalReport,
  vendorReportAoa,
  vendorTotals,
} from "@/src/utils/reports-export";
import { buildAuditLogPdfBytes, buildFarmerDetailsPdfBytes, buildVendorDetailsPdfBytes } from "@/src/utils/report-pdf";
import { api, AuctionDay, Patti, PattiAuditLogEntry, Settings, ShopProfile, VendorBill } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { Empty, Input } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";

type Mode = "entry" | "driver" | "farmer" | "vendor" | "audit";
type ExportKind = "farmer" | "vendor" | "audit";
type ExportAction = "save" | "share";
type ExportFormat = "pdf" | "xlsx";

type FormatPicker = { kind: ExportKind; action: ExportAction } | null;

function notify(title: string, body: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert(`${title}\n\n${body}`);
    return;
  }
  Alert.alert(title, body);
}

function exportResultMessage(
  result: "shared" | "downloaded" | "printed",
  format: ExportFormat,
  action: ExportAction,
): { title: string; body: string } {
  const file = format === "pdf" ? "PDF" : "Excel (.xlsx)";
  if (result === "shared") return { title: "Shared", body: `${file} opened in the share sheet.` };
  if (result === "downloaded") {
    return {
      title: action === "save" ? "Saved" : "Downloaded",
      body:
        action === "save"
          ? `${file} downloaded. Check your Downloads folder.`
          : `${file} downloaded (browser share unavailable). Check your Downloads folder.`,
    };
  }
  if (result === "printed" && format === "pdf") {
    return {
      title: "Ready",
      body: "PDF is ready.",
    };
  }
  return { title: "Ready", body: `${file} is ready.` };
}

/** e.g. 2026-08-14 → 14-08-2026 for clear download filenames. */
function pdfDateStamp(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso.replace(/[^\w.\-]+/g, "_");
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export default function Reports() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";
  const { workingDateISO, displayDate } = useWorkingDate();

  const [mode, setMode] = useState<Mode>("entry");
  const [pattis, setPattis] = useState<Patti[] | null>(null);
  const [bills, setBills] = useState<VendorBill[] | null>(null);
  const [auditRows, setAuditRows] = useState<PattiAuditLogEntry[] | null>(null);
  const [shopName, setShopName] = useState(session?.shop_name || "");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [formatPicker, setFormatPicker] = useState<FormatPicker>(null);
  const [search, setSearch] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [auctionDrivers, setAuctionDrivers] = useState<DriverRangeRef[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [ps, vs, profile, st, day] = await Promise.all([
        api.get<Patti[]>(`/pattis?date=${workingDateISO}`),
        api.get<VendorBill[]>(`/vendor-bills?date=${workingDateISO}`),
        api.get<ShopProfile>("/shop/profile").catch(() => null),
        api.get<Settings>("/settings").catch(() => null),
        api.get<AuctionDay>(`/auction-days/today?date=${workingDateISO}`).catch(() => null),
      ]);
      setPattis(ps || []);
      setBills(vs || []);
      setSettings(st);
      setAuctionDrivers(
        (day?.drivers || []).map((d) => ({
          range_from: d.range_from,
          range_to: d.range_to,
          name: d.name,
        })),
      );
      if (profile?.shop_name) setShopName(profile.shop_name);
      else if (session?.shop_name) setShopName(session.shop_name);

      if (session?.role === "owner") {
        const audit = await api
          .get<PattiAuditLogEntry[]>(`/reports/audit-log?date=${workingDateISO}`)
          .catch(() => []);
        setAuditRows(audit || []);
      } else {
        setAuditRows(null);
        setMode((m) => (m === "audit" ? "entry" : m));
      }
    } catch {
      setPattis([]);
      setBills([]);
      setAuctionDrivers([]);
      setAuditRows(session?.role === "owner" ? [] : null);
    } finally {
      setLoading(false);
    }
  }, [workingDateISO, session?.shop_name, session?.role]);

  useFocusEffect(
    useCallback(() => {
      setSelectedDriver(null);
      void load();
    }, [load]),
  );

  const merchant = shopName || session?.shop_name || "LEMON MANDI";
  const userName = session?.display_name || session?.username || "";

  const drivers = useMemo(() => groupDrivers(pattis || []), [pattis]);
  const driverDetail = useMemo(
    () => drivers.find((d) => d.driver_name === selectedDriver) || null,
    [drivers, selectedDriver],
  );

  const entryFiltered = useMemo(() => {
    const items = pattis || [];
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((p) => {
      const lots = (p.lots || []).map((l) => (l.lot_no || "").toLowerCase()).join(" ");
      return (
        String(p.patti_no).includes(s) ||
        `pt-${String(p.patti_no).padStart(6, "0")}`.includes(s) ||
        (p.farmer_name || "").toLowerCase().includes(s) ||
        (p.driver_name || "").toLowerCase().includes(s) ||
        (p.receiver_name || "").toLowerCase().includes(s) ||
        lots.includes(s)
      );
    });
  }, [pattis, search]);

  const auditFiltered = useMemo(() => {
    const items = auditRows || [];
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((r) => {
      return (
        String(r.patti_no).includes(s) ||
        (r.lot_no || "").toLowerCase().includes(s) ||
        (r.farmer_name || "").toLowerCase().includes(s) ||
        (r.driver_name || "").toLowerCase().includes(s) ||
        (r.action || "").toLowerCase().includes(s) ||
        (r.by || "").toLowerCase().includes(s)
      );
    });
  }, [auditRows, search]);

  const fTotals = useMemo(() => farmerTotals(pattis || [], auctionDrivers), [pattis, auctionDrivers]);
  const vTotals = useMemo(() => vendorTotals(bills || []), [bills]);

  const runExport = async (fn: () => Promise<void>) => {
    try {
      setExporting(true);
      await fn();
    } catch (e: any) {
      notify("Failed", e?.message || e?.detail || "Could not export");
    } finally {
      setExporting(false);
    }
  };

  const exportDriver = (d: DriverSummary, action: "print" | "share") => {
    if (!isOwner) return;
    void runExport(async () => {
      if (action === "print") {
        await thermalPrintDriverReport(d, workingDateISO, merchant, settings);
        notify("Printed", "Driver report sent to the thermal printer.");
      } else {
        const result = await shareDriverThermalReport(d, workingDateISO, merchant, settings);
        if (result === "shared") notify("Shared", "Driver report PDF opened in the share sheet.");
        else if (result === "downloaded") {
          notify("Downloaded", "Driver report PDF downloaded (same layout as Print).");
        } else notify("Ready", "Driver report PDF is ready.");
      }
    });
  };

  const runDetailExport = (kind: ExportKind, action: ExportAction, format: ExportFormat) => {
    if (!isOwner) return;
    setFormatPicker(null);
    void runExport(async () => {
      const title =
        kind === "farmer" ? "Farmer Details" : kind === "vendor" ? "Vendor Details" : "Audit Log";
      const stem =
        kind === "farmer" ? "farmer-details" : kind === "vendor" ? "vendor-details" : "audit-log";

      if (format === "pdf") {
        // Real jsPDF A4 bytes (selectable text, multi-page) — never screenshot / HTML print capture.
        const stamp = pdfDateStamp(workingDateISO);
        const filename =
          kind === "farmer"
            ? `Farmer_Details_${stamp}.pdf`
            : kind === "vendor"
              ? `Vendor_Details_${stamp}.pdf`
              : `Audit_Log_${stamp}.pdf`;
        const bytes =
          kind === "farmer"
            ? buildFarmerDetailsPdfBytes(
                pattis || [],
                workingDateISO,
                merchant,
                userName,
                auctionDrivers,
              )
            : kind === "vendor"
              ? buildVendorDetailsPdfBytes(bills || [], workingDateISO, merchant, userName)
              : buildAuditLogPdfBytes(auditFiltered, workingDateISO, merchant, userName);
        const result = await exportPdfBytes(bytes, filename, title, action);
        const msg = exportResultMessage(result, "pdf", action);
        notify(msg.title, msg.body);
        return;
      }

      const rows =
        kind === "farmer"
          ? farmerReportAoa(pattis || [], workingDateISO, merchant, auctionDrivers)
          : kind === "vendor"
            ? vendorReportAoa(bills || [], workingDateISO, merchant)
            : auditReportAoa(auditFiltered, workingDateISO, merchant);
      const result = await shareXlsx(rows, `${stem}-${workingDateISO}.xlsx`, `${title} Excel`, action);
      const msg = exportResultMessage(result, "xlsx", action);
      notify(msg.title, msg.body);
    });
  };

  // Merchant only: Print / Save (PDF·Excel) / Share. Staff may view + search only.
  const showActions =
    !!isOwner &&
    ((mode === "farmer" && !selectedDriver) ||
      (mode === "vendor" && !selectedDriver) ||
      (mode === "audit" && !selectedDriver) ||
      (mode === "driver" && !!driverDetail));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          {mode === "driver" && driverDetail ? (
            <Pressable
              onPress={() => setSelectedDriver(null)}
              style={styles.backRow}
              testID="reports-driver-back"
            >
              <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
              <Text style={styles.backText}>DRIVERS</Text>
            </Pressable>
          ) : null}
          <Text style={styles.title}>
            {mode === "driver" && driverDetail ? driverDetail.driver_name.toUpperCase() : "REPORTS"}
          </Text>
          <Text style={styles.subtitle}>{displayDate}</Text>
        </View>
        {showActions ? (
          <View style={styles.headerActions}>
            <Pressable
              style={styles.actionBtn}
              disabled={exporting}
              onPress={() => {
                if (mode === "driver" && driverDetail) exportDriver(driverDetail, "print");
                else if (mode === "farmer") setFormatPicker({ kind: "farmer", action: "save" });
                else if (mode === "vendor") setFormatPicker({ kind: "vendor", action: "save" });
                else if (mode === "audit") setFormatPicker({ kind: "audit", action: "save" });
              }}
              testID="reports-save"
            >
              <Ionicons
                name={mode === "driver" ? "print-outline" : "download-outline"}
                size={14}
                color={colors.onSurfaceInverse}
              />
              <Text style={styles.actionBtnText}>
                {exporting ? "…" : mode === "driver" ? "PRINT" : "SAVE"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              disabled={exporting}
              onPress={() => {
                if (mode === "driver" && driverDetail) exportDriver(driverDetail, "share");
                else if (mode === "farmer") setFormatPicker({ kind: "farmer", action: "share" });
                else if (mode === "vendor") setFormatPicker({ kind: "vendor", action: "share" });
                else if (mode === "audit") setFormatPicker({ kind: "audit", action: "share" });
              }}
              testID="reports-share"
            >
              <Ionicons name="share-outline" size={14} color={colors.onSurfaceInverse} />
              <Text style={styles.actionBtnText}>{exporting ? "…" : "SHARE"}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Modal
        visible={!!formatPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setFormatPicker(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setFormatPicker(null)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {formatPicker?.action === "share" ? "SHARE AS" : "SAVE / EXPORT AS"}
            </Text>
            <Text style={styles.modalSub}>
              {formatPicker?.kind === "vendor"
                ? "Vendor Details"
                : formatPicker?.kind === "audit"
                  ? "Audit Log"
                  : "Farmer Details"}{" "}
              · {displayDate}
            </Text>
            <Pressable
              style={styles.modalOption}
              disabled={exporting}
              onPress={() => formatPicker && runDetailExport(formatPicker.kind, formatPicker.action, "pdf")}
              testID="reports-export-pdf"
            >
              <Ionicons name="document-text-outline" size={18} color={colors.onSurface} />
              <Text style={styles.modalOptionText}>A4 PDF</Text>
            </Pressable>
            <Pressable
              style={styles.modalOption}
              disabled={exporting}
              onPress={() => formatPicker && runDetailExport(formatPicker.kind, formatPicker.action, "xlsx")}
              testID="reports-export-xlsx"
            >
              <Ionicons name="grid-outline" size={18} color={colors.onSurface} />
              <Text style={styles.modalOptionText}>Excel (.xlsx)</Text>
            </Pressable>
            <Pressable style={styles.modalCancel} onPress={() => setFormatPicker(null)}>
              <Text style={styles.modalCancelText}>CANCEL</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {!(mode === "driver" && driverDetail) ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.segRow}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: 0 }}
        >
          <Seg label="ENTRY BOOK" active={mode === "entry"} onPress={() => { setMode("entry"); setSelectedDriver(null); setSearch(""); }} testID="report-seg-entry" />
          <Seg label="DRIVER DETAILS" active={mode === "driver"} onPress={() => { setMode("driver"); setSelectedDriver(null); setSearch(""); }} testID="report-seg-driver" />
          <Seg label="FARMER DETAILS" active={mode === "farmer"} onPress={() => { setMode("farmer"); setSelectedDriver(null); setSearch(""); }} testID="report-seg-farmer" />
          <Seg label="VENDOR DETAILS" active={mode === "vendor"} onPress={() => { setMode("vendor"); setSelectedDriver(null); setSearch(""); }} testID="report-seg-vendor" />
          {isOwner ? (
            <Seg label="AUDIT LOG" active={mode === "audit"} onPress={() => { setMode("audit"); setSelectedDriver(null); setSearch(""); }} testID="report-seg-audit" />
          ) : null}
        </ScrollView>
      ) : null}

      {loading && pattis === null && bills === null ? (
        <View style={{ padding: spacing.xxl, alignItems: "center" }}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : mode === "entry" ? (
        <EntryBook
          rows={entryFiltered}
          search={search}
          onSearch={setSearch}
          loading={loading}
          drivers={auctionDrivers}
          onOpen={(id) => router.push(`/patti/${id}`)}
        />
      ) : mode === "driver" && driverDetail ? (
        <DriverDetailView d={driverDetail} drivers={auctionDrivers} />
      ) : mode === "driver" ? (
        <FlatList
          data={drivers}
          keyExtractor={(x) => x.driver_name}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100 }}
          ListEmptyComponent={
            loading ? null : (
              <Empty title="No drivers" subtitle="Add lots with drivers for this date." testID="drivers-empty" />
            )
          }
          ListHeaderComponent={
            drivers.length ? (
              <View style={styles.thRow}>
                <Text style={[styles.th, { flex: 1.4 }]}>DRIVER</Text>
                <Text style={[styles.th, { flex: 0.7, textAlign: "right" }]}>FROM</Text>
                <Text style={[styles.th, { flex: 0.7, textAlign: "right" }]}>TO</Text>
                <Text style={[styles.th, { flex: 0.6, textAlign: "right" }]}>BAGS</Text>
                <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>BHADA</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => setSelectedDriver(item.driver_name)}
              testID={`driver-row-${item.driver_name}`}
            >
              <View style={{ flex: 1.4 }}>
                <Text style={styles.label} numberOfLines={1}>{item.driver_name}</Text>
                {item.place ? <Text style={styles.small}>{item.place}</Text> : null}
              </View>
              <Text style={[styles.mono, { flex: 0.7, textAlign: "right" }]} numberOfLines={1}>{item.lot_from}</Text>
              <Text style={[styles.mono, { flex: 0.7, textAlign: "right" }]} numberOfLines={1}>{item.lot_to}</Text>
              <Text style={[styles.mono, { flex: 0.6, textAlign: "right" }]}>{item.total_bags}</Text>
              <Text style={[styles.mono, styles.strong, { flex: 1, textAlign: "right" }]}>{money(item.total_bhada)}</Text>
            </Pressable>
          )}
        />
      ) : mode === "farmer" ? (
        <FlatList
          data={pattis || []}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 120 }}
          ListEmptyComponent={
            loading ? null : (
              <Empty title="No pattis" subtitle="Generate pattis for this date." testID="farmer-empty" />
            )
          }
          ListHeaderComponent={
            (pattis || []).length ? (
              <View style={styles.thRow}>
                <Text style={[styles.th, { flex: 0.5 }]}>PATTI</Text>
                <Text style={[styles.th, { flex: 0.65 }]}>LOT</Text>
                <Text style={[styles.th, { flex: 1 }]}>FARMER</Text>
                <Text style={[styles.th, { flex: 0.45, textAlign: "right" }]}>BAGS</Text>
                <Text style={[styles.th, { flex: 0.7, textAlign: "right" }]}>BHADA</Text>
                <Text style={[styles.th, { flex: 0.85, textAlign: "right" }]}>GROSS</Text>
                <Text style={[styles.th, { flex: 0.85, textAlign: "right" }]}>PAYABLE</Text>
                <Text style={[styles.th, { flex: 0.75 }]}>RECV</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            (pattis || []).length ? (
              <TotalsBlock
                rows={[
                  { label: "TOTAL BAGS", value: String(fTotals.total_bags) },
                  { label: "TOTAL BHADA", value: money(fTotals.total_bhada) },
                  { label: "TOTAL GROSS TOTAL", value: money(fTotals.total_gross) },
                  { label: "TOTAL PAYABLE AMOUNT", value: money(fTotals.gross_payable), emphasize: true },
                ]}
              />
            ) : null
          }
          renderItem={({ item }) => <FarmerDetailsRow p={item} drivers={auctionDrivers} />}
        />
      ) : mode === "audit" ? (
        <AuditLogView rows={auditFiltered} search={search} onSearch={setSearch} loading={loading} />
      ) : (
        <FlatList
          data={bills || []}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 120 }}
          ListEmptyComponent={
            loading ? null : (
              <Empty title="No vendor bills" subtitle="Post vendor bills for this date." testID="vendor-empty" />
            )
          }
          ListHeaderComponent={
            (bills || []).length ? (
              <View style={styles.thRow}>
                <Text style={[styles.th, { flex: 1.2 }]}>BILL NO.</Text>
                <Text style={[styles.th, { flex: 1.4 }]}>VENDOR</Text>
                <Text style={[styles.th, { flex: 0.7, textAlign: "right" }]}>BAGS</Text>
                <Text style={[styles.th, { flex: 1.1, textAlign: "right" }]}>AMOUNT</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            (bills || []).length ? (
              <TotalsBlock
                rows={[
                  { label: "TOTAL BAGS", value: String(vTotals.total_bags) },
                  { label: "TOTAL BILL AMOUNT", value: money(vTotals.bill_amount), emphasize: true },
                ]}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={[styles.mono, styles.strong, { flex: 1.2 }]} numberOfLines={1}>{item.bill_code}</Text>
              <Text style={[styles.cellDim, { flex: 1.4 }]} numberOfLines={1}>{item.vendor_name}</Text>
              <Text style={[styles.mono, { flex: 0.7, textAlign: "right" }]}>{item.total_bags}</Text>
              <Text style={[styles.mono, styles.strong, { flex: 1.1, textAlign: "right", color: colors.brandPrimary }]}>
                {money(item.grand_total)}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function formatAuditWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AuditLogView({
  rows,
  search,
  onSearch,
  loading,
}: {
  rows: PattiAuditLogEntry[];
  search: string;
  onSearch: (s: string) => void;
  loading: boolean;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <Input
          placeholder="Search patti, lot, farmer, driver, action…"
          value={search}
          onChangeText={onSearch}
          autoCapitalize="none"
          autoCorrect={false}
          testID="audit-search"
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 120, paddingTop: 0 }}
        ListEmptyComponent={
          loading ? null : (
            <Empty
              title="No audit records"
              subtitle="Deleted and reprinted Farmer Pattis for this date appear here."
              testID="audit-empty"
            />
          )
        }
        ListHeaderComponent={
          rows.length ? (
            <View style={styles.thRow}>
              <Text style={[styles.th, { flex: 0.55 }]}>PATTI</Text>
              <Text style={[styles.th, { flex: 0.7 }]}>LOT</Text>
              <Text style={[styles.th, { flex: 0.45, textAlign: "right" }]}>BAGS</Text>
              <Text style={[styles.th, { flex: 1.1 }]}>FARMER</Text>
              <Text style={[styles.th, { flex: 0.9 }]}>DRIVER</Text>
              <Text style={[styles.th, { flex: 0.85 }]}>ACTION</Text>
              <Text style={[styles.th, { flex: 1.1 }]}>DATE/TIME</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.row} testID={`audit-row-${item.id}`}>
            <Text style={[styles.mono, styles.strong, { flex: 0.55 }]} numberOfLines={1}>
              #{item.patti_no}
            </Text>
            <Text style={[styles.mono, { flex: 0.7 }]} numberOfLines={1}>
              {item.lot_no || "—"}
            </Text>
            <Text style={[styles.mono, { flex: 0.45, textAlign: "right" }]}>{item.bags}</Text>
            <Text style={[styles.cellDim, { flex: 1.1 }]} numberOfLines={1}>
              {item.farmer_name || "—"}
            </Text>
            <Text style={[styles.cellDim, { flex: 0.9 }]} numberOfLines={1}>
              {item.driver_name || "—"}
            </Text>
            <Text
              style={[
                styles.mono,
                styles.strong,
                { flex: 0.85 },
                item.action === "DELETED" ? { color: colors.error } : null,
              ]}
              numberOfLines={1}
            >
              {item.action}
            </Text>
            <Text style={[styles.cellDim, { flex: 1.1 }]} numberOfLines={2}>
              {formatAuditWhen(item.at)}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

function EntryBook({
  rows,
  search,
  onSearch,
  loading,
  drivers,
  onOpen,
}: {
  rows: Patti[];
  search: string;
  onSearch: (s: string) => void;
  loading: boolean;
  drivers: DriverRangeRef[];
  onOpen: (id: string) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <Input
          placeholder="Search lot, farmer, driver, patti…"
          value={search}
          onChangeText={onSearch}
          autoCapitalize="none"
          autoCorrect={false}
          testID="entry-search"
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100, paddingTop: 0 }}
        ListEmptyComponent={
          loading ? null : (
            <Empty title="No entries" subtitle="No pattis for this working date." testID="entry-empty" />
          )
        }
        ListHeaderComponent={
          rows.length ? (
            <View style={styles.thRow}>
              <Text style={[styles.th, { flex: 1 }]}>LOT NO.</Text>
              <Text style={[styles.th, { flex: 0.55, textAlign: "right" }]}>BAGS</Text>
              <Text style={[styles.th, { flex: 1.2 }]}>FARMER</Text>
              <Text style={[styles.th, { flex: 1 }]}>DRIVER</Text>
              <Text style={[styles.th, { flex: 1 }]}>RECEIVER</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const received = isPattiReceived(item, drivers);
          return (
            <Pressable
              style={[styles.row, received && styles.rowReceived]}
              onPress={() => onOpen(item.id)}
              testID={`entry-row-${item.id}`}
            >
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4 }}>
                {received ? <Text style={styles.check}>✓</Text> : null}
                <Text style={styles.mono} numberOfLines={1}>{lotLabel(item)}</Text>
              </View>
              <Text style={[styles.mono, { flex: 0.55, textAlign: "right" }]}>{item.total_bags}</Text>
              <Text style={[styles.cellDim, { flex: 1.2 }]} numberOfLines={1}>{item.farmer_name}</Text>
              <Text style={[styles.cellDim, { flex: 1 }]} numberOfLines={1}>{item.driver_name || "—"}</Text>
              <Text style={[styles.cellDim, { flex: 1 }]} numberOfLines={1}>{receiverDisplay(item, drivers)}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function DriverDetailView({ d, drivers }: { d: DriverSummary; drivers: DriverRangeRef[] }) {
  const totals = driverDetailTotals(d.pattis, drivers);
  return (
    <FlatList
      data={d.pattis}
      keyExtractor={(x) => x.id}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 120 }}
      ListHeaderComponent={
        <View>
          <Text style={styles.detailMeta}>
            Lots {d.lot_from} – {d.lot_to}
            {d.place ? ` · ${d.place}` : ""}
          </Text>
          <View style={[styles.thRow, { marginTop: spacing.sm }]}>
            <Text style={[styles.th, { flex: 0.55 }]}>PATTI</Text>
            <Text style={[styles.th, { flex: 0.75 }]}>LOT</Text>
            <Text style={[styles.th, { flex: 1.1 }]}>FARMER</Text>
            <Text style={[styles.th, { flex: 0.5, textAlign: "right" }]}>BAGS</Text>
            <Text style={[styles.th, { flex: 0.8, textAlign: "right" }]}>BHADA</Text>
            <Text style={[styles.th, { flex: 0.9, textAlign: "right" }]}>PAYABLE</Text>
            <Text style={[styles.th, { flex: 0.8 }]}>RECV</Text>
          </View>
        </View>
      }
      ListFooterComponent={
        <TotalsBlock
          rows={[
            { label: "TOTAL BAGS", value: String(totals.total_bags) },
            { label: "TOTAL BHADA", value: money(totals.total_bhada) },
            { label: "GROSS PAYABLE", value: money(totals.gross_payable) },
            { label: "RECEIVED", value: money(totals.received_amount) },
            { label: "OUTSTANDING", value: money(totals.outstanding), emphasize: true },
          ]}
        />
      }
      renderItem={({ item }) => <PattiMoneyRow p={item} drivers={drivers} />}
    />
  );
}

function FarmerDetailsRow({ p, drivers }: { p: Patti; drivers: DriverRangeRef[] }) {
  const received = isPattiReceived(p, drivers);
  return (
    <View style={[styles.row, received && styles.rowReceived]}>
      <View style={{ flex: 0.5, flexDirection: "row", alignItems: "center", gap: 2 }}>
        {received ? <Text style={styles.check}>✓</Text> : null}
        <Text style={styles.mono}>#{p.patti_no}</Text>
      </View>
      <Text style={[styles.mono, { flex: 0.65 }]} numberOfLines={1}>{lotLabel(p)}</Text>
      <Text style={[styles.cellDim, { flex: 1 }]} numberOfLines={1}>{p.farmer_name}</Text>
      <Text style={[styles.mono, { flex: 0.45, textAlign: "right" }]}>{p.total_bags}</Text>
      <Text style={[styles.mono, { flex: 0.7, textAlign: "right" }]}>{money(p.bhada_total)}</Text>
      <Text style={[styles.mono, { flex: 0.85, textAlign: "right" }]}>{money(p.farmer_gross)}</Text>
      <Text
        style={[
          styles.mono,
          styles.strong,
          { flex: 0.85, textAlign: "right" },
          received && styles.strike,
        ]}
      >
        {money(p.net_payable)}
      </Text>
      <Text style={[styles.cellDim, { flex: 0.75 }]} numberOfLines={1}>{receiverDisplay(p, drivers)}</Text>
    </View>
  );
}

function PattiMoneyRow({ p, drivers }: { p: Patti; drivers?: DriverRangeRef[] }) {
  const received = isPattiReceived(p, drivers);
  return (
    <View style={[styles.row, received && styles.rowReceived]}>
      <View style={{ flex: 0.55, flexDirection: "row", alignItems: "center", gap: 2 }}>
        {received ? <Text style={styles.check}>✓</Text> : null}
        <Text style={styles.mono}>#{p.patti_no}</Text>
      </View>
      <Text style={[styles.mono, { flex: 0.75 }]} numberOfLines={1}>{lotLabel(p)}</Text>
      <Text style={[styles.cellDim, { flex: 1.1 }]} numberOfLines={1}>{p.farmer_name}</Text>
      <Text style={[styles.mono, { flex: 0.5, textAlign: "right" }]}>{p.total_bags}</Text>
      <Text style={[styles.mono, { flex: 0.8, textAlign: "right" }]}>{money(p.bhada_total)}</Text>
      <Text
        style={[
          styles.mono,
          styles.strong,
          { flex: 0.9, textAlign: "right" },
          received && styles.strike,
        ]}
      >
        {money(p.net_payable)}
      </Text>
      <Text style={[styles.cellDim, { flex: 0.8 }]} numberOfLines={1}>{receiverDisplay(p, drivers)}</Text>
    </View>
  );
}

function TotalsBlock({
  rows,
}: {
  rows: { label: string; value: string; emphasize?: boolean }[];
}) {
  return (
    <View style={styles.totalsBox}>
      {rows.map((r) =>
        r.emphasize ? (
          <View key={r.label} style={styles.totalEmph}>
            <Text style={styles.totalEmphLabel}>{r.label}</Text>
            <Text style={styles.totalEmphValue}>{r.value}</Text>
          </View>
        ) : (
          <View key={r.label} style={styles.totalRow}>
            <Text style={styles.totalLabel}>{r.label}</Text>
            <Text style={styles.totalValue}>{r.value}</Text>
          </View>
        ),
      )}
    </View>
  );
}

function Seg({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable testID={testID} style={[styles.seg, active && styles.segActive]} onPress={onPress}>
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: colors.onSurface,
    fontFamily: font.display,
    letterSpacing: -0.5,
  },
  subtitle: { fontSize: 12, color: colors.muted, fontFamily: font.mono, fontWeight: "700" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 2, marginBottom: 2 },
  backText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.onSurface,
    fontFamily: font.display,
  },
  headerActions: { flexDirection: "row", gap: 6 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceInverse,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: colors.surfaceInverse,
  },
  actionBtnText: {
    color: colors.onSurfaceInverse,
    fontFamily: font.display,
    fontWeight: "900",
    letterSpacing: 1,
    fontSize: 11,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    gap: spacing.sm,
    zIndex: 1,
  },
  modalTitle: {
    fontFamily: font.display,
    fontWeight: "900",
    letterSpacing: 1.2,
    fontSize: 14,
    color: colors.onSurface,
  },
  modalSub: {
    fontFamily: font.display,
    fontSize: 12,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceSecondary,
  },
  modalOptionText: {
    fontFamily: font.display,
    fontWeight: "800",
    fontSize: 14,
    color: colors.onSurface,
  },
  modalCancel: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 4,
  },
  modalCancelText: {
    fontFamily: font.display,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.muted,
    fontSize: 12,
  },

  segRow: { maxHeight: 46, marginTop: spacing.md, flexGrow: 0 },
  seg: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    marginRight: -2,
    minHeight: 36,
    flexShrink: 0,
  },
  segActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  segText: {
    fontFamily: font.display,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.onSurface,
    fontSize: 10,
  },
  segTextActive: { color: colors.onSurfaceInverse },

  thRow: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderColor: colors.borderStrong,
    paddingBottom: 8,
    gap: 4,
  },
  th: {
    fontSize: 9,
    letterSpacing: 0.8,
    fontFamily: font.display,
    fontWeight: "800",
    color: colors.muted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  rowReceived: { backgroundColor: colors.brandSecondary },
  label: { fontSize: 14, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  cellDim: { fontSize: 12, fontWeight: "700", color: colors.onSurface, fontFamily: font.display },
  small: { fontSize: 11, color: colors.muted, fontFamily: font.display, marginTop: 2 },
  mono: { fontSize: 12, color: colors.onSurface, fontFamily: font.mono },
  strong: { fontWeight: "800" },
  strike: { textDecorationLine: "line-through", color: colors.muted },
  check: { color: colors.brandPrimary, fontWeight: "900", fontSize: 13 },
  detailMeta: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: font.display,
    fontWeight: "700",
  },

  totalsBox: {
    marginTop: spacing.md,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    gap: 6,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: {
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: "800",
    color: colors.muted,
    fontFamily: font.display,
  },
  totalValue: { fontSize: 14, fontWeight: "800", fontFamily: font.mono, color: colors.onSurface },
  totalEmph: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surfaceInverse,
    padding: spacing.md,
    marginTop: 4,
  },
  totalEmphLabel: {
    color: colors.onSurfaceInverse,
    fontFamily: font.display,
    fontWeight: "900",
    letterSpacing: 1.5,
    fontSize: 12,
  },
  totalEmphValue: {
    color: colors.onSurfaceInverse,
    fontFamily: font.mono,
    fontWeight: "900",
    fontSize: 18,
  },
});
