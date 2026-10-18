import { useCallback, useState } from "react";
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { DatePickerModal } from "@/src/components/DatePickerModal";
import { Button } from "@/src/components/ui";
import { useAuth } from "@/src/context/AuthContext";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { colors, font, money, spacing } from "@/src/theme";
import { exportCashBookPdf } from "@/src/utils/cash-book-pdf";
import {
  deleteCashBookEntry,
  fetchCashBookDay,
  migrateLegacyLocalCashBook,
  peekLegacyLocalCashBookEntries,
  wasLocalCashBookMigrated,
  type CashBookDay,
  type CashBookEntry,
} from "@/src/utils/cash-book-store";

const EMPTY_DAY = (date: string): CashBookDay => ({
  date,
  credits: [],
  debits: [],
  totalCredit: 0,
  totalDebit: 0,
  net: 0,
  openingBalance: 0,
  closingBalance: 0,
});

export default function CashBookScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";
  const { workingDate, workingDateISO, displayDate, setWorkingDate } = useWorkingDate();
  const [day, setDay] = useState<CashBookDay>(EMPTY_DAY(workingDateISO));
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<CashBookEntry | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<"save" | "share" | null>(null);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [migrateNote, setMigrateNote] = useState<string | null>(null);

  const shopName = session?.shop_name || "LEMON MANDI";

  const maybeMigrateLocal = useCallback(async () => {
    try {
      if (await wasLocalCashBookMigrated()) return;
      const legacy = await peekLegacyLocalCashBookEntries();
      if (!legacy.length) {
        await migrateLegacyLocalCashBook();
        return;
      }
      const res = await migrateLegacyLocalCashBook();
      if (res.imported > 0) {
        setMigrateNote(`Imported ${res.imported} local Cash Book entr${res.imported === 1 ? "y" : "ies"} to the server.`);
      }
    } catch {
      // Do not block the live day load; user can retry later.
    }
  }, []);

  const load = useCallback(async () => {
    if (!isOwner) return;
    try {
      setLoading(true);
      setLoadError(null);
      await maybeMigrateLocal();
      const next = await fetchCashBookDay(workingDateISO);
      setDay(next);
    } catch (e: any) {
      setLoadError(e?.message || "Could not load Cash Book from server");
      setDay(EMPTY_DAY(workingDateISO));
    } finally {
      setLoading(false);
    }
  }, [isOwner, workingDateISO, maybeMigrateLocal]);

  useFocusEffect(
    useCallback(() => {
      if (!isOwner) return;
      load();
    }, [isOwner, load]),
  );

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} testID="cash-book-back">
            <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>CASH BOOK</Text>
          </View>
        </View>
        <View style={styles.denied}>
          <Text style={styles.deniedText} testID="cash-book-owner-only">
            Cash Book is available only to the Owner.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const openEntryActions = (entry: CashBookEntry) => {
    setSelected(entry);
    setConfirmDelete(false);
    setActionError(null);
    setShowActions(true);
  };

  const closeActions = () => {
    setShowActions(false);
    setConfirmDelete(false);
    setSelected(null);
    setActionError(null);
    setDeleting(false);
  };

  const onEdit = () => {
    if (!selected) return;
    const id = selected.id;
    const side = selected.side;
    closeActions();
    router.push({ pathname: "/cash-book/entry", params: { side, id } });
  };

  const onConfirmDelete = async () => {
    const entry = selected;
    if (!entry) return;
    setActionError(null);
    try {
      setDeleting(true);
      await deleteCashBookEntry(entry.id);
      setShowActions(false);
      setConfirmDelete(false);
      setSelected(null);
      await load();
    } catch (e: any) {
      setActionError(e?.message || "Could not delete entry");
      setShowActions(true);
      setConfirmDelete(true);
      setSelected(entry);
    } finally {
      setDeleting(false);
    }
  };

  const onExportPdf = async (mode: "save" | "share") => {
    if (pdfBusy) return;
    try {
      setPdfBusy(mode);
      setPdfStatus(null);
      // Always export the on-screen day snapshot so totals match exactly.
      const result = await exportCashBookPdf(day, displayDate, mode, shopName);
      let msg = "Cash Book PDF is ready.";
      if (result === "shared") msg = "Cash Book PDF opened in the share sheet.";
      else if (result === "downloaded") {
        msg = mode === "save"
          ? "Cash Book PDF downloaded. Check your Downloads folder."
          : "Cash Book PDF downloaded (share unavailable). Check your Downloads folder.";
      }
      setPdfStatus(msg);
      Alert.alert(result === "shared" ? "Shared" : result === "downloaded" ? (mode === "save" ? "Saved" : "Downloaded") : "Ready", msg);
    } catch (e: any) {
      const err = e?.message || (mode === "save" ? "Could not save PDF." : "Could not share PDF.");
      setPdfStatus(err);
      Alert.alert("Cash Book PDF", err);
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="cash-book-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>CASH BOOK</Text>
        </View>
      </View>

      {showPicker ? (
        <DatePickerModal
          visible={showPicker}
          value={workingDate}
          onCancel={() => setShowPicker(false)}
          onApply={(d) => {
            setShowPicker(false);
            if (d) setWorkingDate(d);
          }}
          title="SELECTED DATE"
          maximumDate={new Date(2100, 11, 31)}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          style={styles.dateRow}
          onPress={() => setShowPicker(true)}
          testID="cash-book-date"
        >
          <Text style={styles.dateLabel}>Selected Date</Text>
          <View style={styles.dateValueRow}>
            <Text style={styles.dateValue}>{displayDate}</Text>
            <Ionicons name="calendar-outline" size={14} color={colors.onSurface} />
          </View>
        </Pressable>

        {loadError ? (
          <View style={styles.errorBox} testID="cash-book-load-error">
            <Text style={styles.errorText}>{loadError}</Text>
            <Button label="RETRY" onPress={load} testID="cash-book-retry" />
          </View>
        ) : null}

        {migrateNote ? (
          <Text style={styles.migrateNote} testID="cash-book-migrate-note">{migrateNote}</Text>
        ) : null}

        <Text style={styles.sectionLabel}>Add Entry</Text>
        <View style={styles.entryOptions}>
          <Pressable
            style={({ pressed }) => [styles.entryCard, pressed && styles.entryCardPressed]}
            onPress={() => router.push({ pathname: "/cash-book/entry", params: { side: "CREDIT" } })}
            testID="cash-book-add-credit"
          >
            <Text style={styles.entryCardTitle}>CREDIT</Text>
            <Text style={styles.entryCardDesc}>Add money in</Text>
            <Ionicons name="add-circle-outline" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.entryCard, pressed && styles.entryCardPressed]}
            onPress={() => router.push({ pathname: "/cash-book/entry", params: { side: "DEBIT" } })}
            testID="cash-book-add-debit"
          >
            <Text style={styles.entryCardTitle}>DEBIT</Text>
            <Text style={styles.entryCardDesc}>Add money out</Text>
            <Ionicons name="remove-circle-outline" size={22} color={colors.onSurface} />
          </Pressable>
        </View>

        <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Day View</Text>
        <View style={styles.cols}>
          <CashBookColumn
            title="CREDIT"
            rows={day.credits}
            emptyLabel="No credit on this date"
            testID="cash-book-credit"
            onPressEntry={openEntryActions}
          />
          <CashBookColumn
            title="DEBIT"
            rows={day.debits}
            emptyLabel="No debit on this date"
            testID="cash-book-debit"
            onPressEntry={openEntryActions}
          />
        </View>

        <View style={styles.totals} testID="cash-book-totals">
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Opening Balance</Text>
            <Text style={styles.totalValue}>{money(day.openingBalance)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Credit</Text>
            <Text style={styles.totalValue}>{money(day.totalCredit)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Debit</Text>
            <Text style={styles.totalValue}>{money(day.totalDebit)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Day Net</Text>
            <Text style={styles.totalValue}>{money(day.net)}</Text>
          </View>
          <View style={[styles.totalRow, styles.netRow]}>
            <Text style={styles.netLabel}>Closing Balance</Text>
            <Text style={styles.netValue}>{money(day.closingBalance)}</Text>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Export</Text>
        <View style={styles.pdfRow}>
          <Pressable
            style={({ pressed }) => [
              styles.pdfBtn,
              pressed && styles.pdfBtnPressed,
              pdfBusy === "save" && { opacity: 0.6 },
            ]}
            onPress={() => { void onExportPdf("save"); }}
            disabled={!!pdfBusy}
            testID="cash-book-save-pdf"
          >
            <Ionicons name="download-outline" size={18} color={colors.onSurface} />
            <Text style={styles.pdfBtnText}>{pdfBusy === "save" ? "Saving…" : "Save A4 PDF"}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.pdfBtn,
              styles.pdfBtnPrimary,
              pressed && styles.pdfBtnPressed,
              pdfBusy === "share" && { opacity: 0.6 },
            ]}
            onPress={() => { void onExportPdf("share"); }}
            disabled={!!pdfBusy}
            testID="cash-book-share-pdf"
          >
            <Ionicons name="share-outline" size={18} color={colors.onPrimary} />
            <Text style={[styles.pdfBtnText, styles.pdfBtnTextPrimary]}>
              {pdfBusy === "share" ? "Sharing…" : "Share PDF"}
            </Text>
          </Pressable>
        </View>
        {pdfStatus ? (
          <Text style={styles.pdfStatus} testID="cash-book-pdf-status">{pdfStatus}</Text>
        ) : null}
      </ScrollView>

      <Modal visible={showActions} transparent animationType="fade" onRequestClose={closeActions}>
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={closeActions}
            testID="cash-book-action-backdrop"
          />
          <View style={styles.modalSheet} testID="cash-book-entry-actions">
            {!confirmDelete ? (
              <>
                <Text style={styles.modalTitle}>
                  {selected?.side} · {selected ? money(selected.amount) : ""}
                </Text>
                <Text style={styles.modalSub} numberOfLines={2}>{selected?.description}</Text>
                <Pressable style={styles.modalBtn} onPress={onEdit} testID="cash-book-action-edit">
                  <Text style={styles.modalBtnText}>Edit</Text>
                </Pressable>
                <Pressable
                  style={styles.modalBtn}
                  onPress={() => setConfirmDelete(true)}
                  testID="cash-book-action-delete"
                >
                  <Text style={[styles.modalBtnText, styles.modalDanger]}>Delete</Text>
                </Pressable>
                <Pressable style={[styles.modalBtn, styles.modalBtnLast]} onPress={closeActions} testID="cash-book-action-cancel">
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Delete entry?</Text>
                <Text style={styles.modalConfirmMsg}>Delete this cash book entry?</Text>
                {actionError ? <Text style={styles.modalErr}>{actionError}</Text> : null}
                <Pressable
                  style={[styles.modalBtn, deleting && { opacity: 0.5 }]}
                  onPress={() => { void onConfirmDelete(); }}
                  disabled={deleting}
                  testID="cash-book-delete-confirm-btn"
                >
                  <Text style={[styles.modalBtnText, styles.modalDanger]}>
                    {deleting ? "Deleting…" : "Delete"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.modalBtn, styles.modalBtnLast]}
                  onPress={() => setConfirmDelete(false)}
                  testID="cash-book-delete-cancel"
                >
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function CashBookColumn({
  title,
  rows,
  emptyLabel,
  testID,
  onPressEntry,
}: {
  title: string;
  rows: CashBookEntry[];
  emptyLabel: string;
  testID: string;
  onPressEntry: (entry: CashBookEntry) => void;
}) {
  return (
    <View style={styles.col} testID={testID}>
      <Text style={styles.colTitle}>{title}</Text>
      {rows.length === 0 ? (
        <Text style={styles.emptyCol}>{emptyLabel}</Text>
      ) : (
        rows.map((r) => (
          <Pressable
            key={r.id}
            style={({ pressed }) => [styles.rowCard, pressed && { opacity: 0.85 }]}
            onPress={() => onPressEntry(r)}
            testID={`cash-book-entry-${r.id}`}
          >
            <Text style={styles.rowAmt}>{money(r.amount)}</Text>
            <Text style={styles.rowDesc} numberOfLines={2}>{r.description}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  denied: { flex: 1, padding: spacing.xl, justifyContent: "center" },
  deniedText: { color: colors.muted, fontFamily: font.display, fontWeight: "700", textAlign: "center" },
  dateRow: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  dateLabel: { fontSize: 11, color: colors.muted, fontFamily: font.display, fontWeight: "800", letterSpacing: 1 },
  dateValueRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  dateValue: { fontSize: 18, fontWeight: "900", color: colors.onSurface, fontFamily: font.display },
  sectionLabel: {
    fontSize: 11, fontWeight: "800", color: colors.muted, fontFamily: font.display,
    letterSpacing: 1.2, marginBottom: spacing.sm,
  },
  entryOptions: { flexDirection: "row", gap: spacing.sm },
  entryCard: {
    flex: 1, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md,
    backgroundColor: colors.surface, gap: 4,
  },
  entryCardPressed: { backgroundColor: colors.surfaceElevated },
  entryCardTitle: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.display },
  entryCardDesc: { fontSize: 12, color: colors.muted, fontFamily: font.display, fontWeight: "600" },
  cols: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  col: { flex: 1, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, minHeight: 120 },
  colTitle: {
    fontSize: 12, fontWeight: "900", color: colors.onSurface, fontFamily: font.display,
    letterSpacing: 1, padding: spacing.sm, borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  emptyCol: { padding: spacing.md, color: colors.muted, fontFamily: font.display, fontSize: 12, fontWeight: "600" },
  rowCard: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowAmt: { fontSize: 14, fontWeight: "900", color: colors.onSurface, fontFamily: font.mono },
  rowDesc: { fontSize: 12, color: colors.onSurfaceTertiary, fontFamily: font.display, fontWeight: "600", marginTop: 2 },
  totals: {
    marginTop: spacing.lg, borderWidth: 2, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, padding: spacing.md, gap: 8,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: 13, color: colors.muted, fontFamily: font.display, fontWeight: "700" },
  totalValue: { fontSize: 14, fontWeight: "800", color: colors.onSurface, fontFamily: font.mono },
  netRow: { marginTop: 4, paddingTop: 8, borderTopWidth: 2, borderTopColor: colors.borderStrong },
  netLabel: { fontSize: 14, fontWeight: "900", color: colors.onSurface, fontFamily: font.display },
  netValue: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.mono },
  pdfRow: { flexDirection: "row", gap: spacing.sm },
  pdfBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: 12, backgroundColor: colors.surface,
  },
  pdfBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  pdfBtnPressed: { opacity: 0.85 },
  pdfBtnText: { fontSize: 13, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  pdfBtnTextPrimary: { color: colors.onPrimary },
  pdfStatus: { marginTop: spacing.sm, fontSize: 12, color: colors.muted, fontFamily: font.display, fontWeight: "600" },
  errorBox: {
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md,
    marginBottom: spacing.md, gap: spacing.sm, backgroundColor: colors.surface,
  },
  errorText: { color: colors.onSurface, fontFamily: font.display, fontWeight: "700", fontSize: 13 },
  migrateNote: { marginBottom: spacing.md, color: colors.muted, fontFamily: font.display, fontWeight: "600", fontSize: 12 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet: { backgroundColor: colors.surface, borderTopWidth: 2, borderColor: colors.borderStrong, padding: spacing.lg },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.display },
  modalSub: { fontSize: 13, color: colors.muted, fontFamily: font.display, marginTop: 4, marginBottom: spacing.md },
  modalConfirmMsg: { fontSize: 13, color: colors.muted, fontFamily: font.display, marginVertical: spacing.md },
  modalBtn: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: colors.border },
  modalBtnLast: { borderBottomWidth: 0 },
  modalBtnText: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontFamily: font.display, textAlign: "center" },
  modalDanger: { color: "#B91C1C" },
  modalErr: { color: "#B91C1C", fontFamily: font.display, fontWeight: "700", marginBottom: spacing.sm },
});
