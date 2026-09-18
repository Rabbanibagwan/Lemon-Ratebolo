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
  getCashBookForDate,
  loadCashBookEntries,
  type CashBookEntry,
} from "@/src/utils/cash-book-store";

export default function CashBookScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { workingDate, workingDateISO, displayDate, setWorkingDate } = useWorkingDate();
  const [entries, setEntries] = useState<CashBookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<CashBookEntry | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<"save" | "share" | null>(null);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);

  const day = getCashBookForDate(entries, workingDateISO);
  const shopName = session?.shop_name || "LEMON MANDI";

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setEntries(await loadCashBookEntries());
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
    const entryId = entry.id;
    const snapshot = entries;
    // Optimistic UI so totals update immediately even if a reload races.
    setEntries(snapshot.filter((r) => r.id !== entryId));
    setShowActions(false);
    setConfirmDelete(false);
    setSelected(null);
    setActionError(null);
    try {
      setDeleting(true);
      const next = await deleteCashBookEntry(entryId, snapshot);
      setEntries(next);
    } catch (e: any) {
      setActionError(e?.message || "Could not delete entry");
      // Roll back from storage if persist failed.
      setEntries(await loadCashBookEntries());
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
          <Text style={styles.headerHint}>PREVIEW · local entries (no live API yet)</Text>
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
            <Text style={styles.totalLabel}>Total Credit</Text>
            <Text style={styles.totalValue}>{money(day.totalCredit)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Debit</Text>
            <Text style={styles.totalValue}>{money(day.totalDebit)}</Text>
          </View>
          <View style={[styles.totalRow, styles.netRow]}>
            <Text style={styles.netLabel}>Net / Closing Balance</Text>
            <Text style={styles.netValue}>{money(day.net)}</Text>
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
              pressed && { opacity: 0.85 },
              pdfBusy === "share" && { opacity: 0.6 },
            ]}
            onPress={() => { void onExportPdf("share"); }}
            disabled={!!pdfBusy}
            testID="cash-book-share-pdf"
          >
            <Ionicons name="share-outline" size={18} color={colors.onBrandPrimary} />
            <Text style={[styles.pdfBtnText, { color: colors.onBrandPrimary }]}>
              {pdfBusy === "share" ? "Sharing…" : "Share PDF"}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.pdfHint}>
          PDF includes only {displayDate} · Credit, Debit, and totals match this screen.
        </Text>
        {pdfStatus ? (
          <Text style={styles.pdfStatus} testID="cash-book-pdf-status">{pdfStatus}</Text>
        ) : null}
      </ScrollView>

      <Modal
        transparent
        visible={showActions && !!selected}
        animationType="fade"
        onRequestClose={closeActions}
      >
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable
            style={styles.backdrop}
            // While confirming delete, ignore backdrop taps so the Delete
            // button cannot be missed / swallowed by the overlay on web.
            onPress={confirmDelete ? undefined : closeActions}
            testID="cash-book-action-backdrop"
          />
          <View style={styles.modalSheet} testID="cash-book-entry-actions">
            {!confirmDelete ? (
              <>
                <Text style={styles.modalTitle}>{selected?.side} ENTRY</Text>
                {selected ? (
                  <Text style={styles.modalMeta} numberOfLines={2}>
                    {money(selected.amount)} · {selected.description}
                  </Text>
                ) : null}
                <Pressable style={styles.modalBtn} onPress={onEdit} testID="cash-book-action-edit">
                  <Text style={styles.modalBtnText}>Edit Entry</Text>
                </Pressable>
                <Pressable
                  style={styles.modalBtn}
                  onPress={() => { setConfirmDelete(true); setActionError(null); }}
                  testID="cash-book-action-delete"
                >
                  <Text style={[styles.modalBtnText, styles.modalBtnDanger]}>Delete Entry</Text>
                </Pressable>
                <Pressable style={[styles.modalBtn, styles.modalBtnLast]} onPress={closeActions} testID="cash-book-action-cancel">
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>DELETE ENTRY</Text>
                <Text style={styles.modalConfirmMsg}>Delete this cash book entry?</Text>
                {selected ? (
                  <Text style={styles.modalMeta} numberOfLines={2}>
                    {money(selected.amount)} · {selected.description}
                  </Text>
                ) : null}
                {actionError ? <Text style={styles.actionErr}>{actionError}</Text> : null}
                <Button
                  label={deleting ? "Deleting…" : "Delete"}
                  variant="danger"
                  loading={deleting}
                  onPress={() => { void onConfirmDelete(); }}
                  testID="cash-book-delete-confirm-btn"
                  style={{ marginBottom: spacing.sm }}
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => { setConfirmDelete(false); setActionError(null); }}
                  testID="cash-book-delete-cancel"
                />
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
      <View style={styles.headRow}>
        <Text style={[styles.headCell, styles.amtCol]}>Amount</Text>
        <Text style={[styles.headCell, styles.descCol]}>Description</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.colEmpty}>{emptyLabel}</Text>
      ) : (
        rows.map((r) => (
          <Pressable
            key={r.id}
            style={({ pressed }) => [styles.lineRow, pressed && styles.lineRowPressed]}
            onPress={() => onPressEntry(r)}
            testID={`cash-book-entry-${r.id}`}
          >
            <Text style={[styles.amt, styles.amtCol]} numberOfLines={1}>{money(r.amount)}</Text>
            <Text style={[styles.desc, styles.descCol]} numberOfLines={2}>{r.description}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 18, fontWeight: "900", fontFamily: font.display, letterSpacing: 0.4, color: colors.onSurface },
  headerHint: { fontSize: 10, letterSpacing: 0.8, color: "#92400E", fontFamily: font.display, fontWeight: "800", marginTop: 2, textTransform: "uppercase" },
  sectionLabel: {
    fontSize: 11, letterSpacing: 2, color: colors.muted, textTransform: "uppercase",
    marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "800",
  },
  dateRow: {
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg,
    backgroundColor: colors.surface,
  },
  dateLabel: { fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  dateValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dateValue: { fontSize: 14, fontFamily: font.mono, fontWeight: "700", color: colors.onSurface },
  entryOptions: { flexDirection: "row", gap: spacing.sm },
  entryCard: {
    flex: 1, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md,
    backgroundColor: colors.surface, gap: 4, minHeight: 96, justifyContent: "space-between",
  },
  entryCardPressed: { backgroundColor: colors.surfaceSecondary },
  entryCardTitle: { fontSize: 16, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, color: colors.onSurface },
  entryCardDesc: { fontSize: 12, fontFamily: font.display, color: colors.muted, fontWeight: "600" },
  cols: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  col: {
    flex: 1, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.sm, backgroundColor: colors.surface, minHeight: 120,
  },
  colTitle: {
    fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: font.display, fontWeight: "900",
    color: colors.onSurface, marginBottom: spacing.sm, textAlign: "center",
  },
  headRow: { flexDirection: "row", gap: 4, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, paddingBottom: 4, marginBottom: 4 },
  headCell: { fontSize: 9, letterSpacing: 0.5, textTransform: "uppercase", color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  amtCol: { width: "42%" },
  descCol: { flex: 1 },
  lineRow: { flexDirection: "row", gap: 4, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.divider },
  lineRowPressed: { backgroundColor: colors.surfaceSecondary },
  amt: { fontSize: 11, fontFamily: font.mono, fontWeight: "700", color: colors.onSurface },
  desc: { fontSize: 11, fontFamily: font.display, fontWeight: "600", color: colors.onSurface },
  colEmpty: { fontSize: 11, color: colors.muted, fontFamily: font.display, marginTop: spacing.sm },
  totals: {
    marginTop: spacing.sm, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, gap: 6, backgroundColor: colors.surface,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  totalValue: { fontSize: 14, fontFamily: font.mono, fontWeight: "800", color: colors.onSurface },
  netRow: { marginTop: 4, paddingTop: 8, borderTopWidth: 2, borderTopColor: colors.borderStrong },
  netLabel: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: colors.onSurface, fontFamily: font.display, fontWeight: "900" },
  netValue: { fontSize: 16, fontFamily: font.mono, fontWeight: "900", color: colors.brandPrimary },
  pdfRow: { flexDirection: "row", gap: spacing.sm },
  pdfBtn: {
    flex: 1, minHeight: 52, borderWidth: 2, borderColor: colors.borderStrong,
    paddingVertical: 12, paddingHorizontal: spacing.sm,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.surface,
  },
  pdfBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brand },
  pdfBtnPressed: { backgroundColor: colors.surfaceSecondary },
  pdfBtnText: {
    fontSize: 12, fontFamily: font.display, fontWeight: "900", letterSpacing: 0.6,
    color: colors.onSurface, textTransform: "uppercase",
  },
  pdfHint: {
    marginTop: spacing.sm, fontSize: 11, color: colors.muted, fontFamily: font.display, lineHeight: 15,
  },
  pdfStatus: {
    marginTop: spacing.sm, fontSize: 12, color: colors.onSurface, fontFamily: font.display,
    fontWeight: "700", lineHeight: 16,
  },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  modalSheet: {
    backgroundColor: colors.surface, borderTopWidth: 2, borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl,
    zIndex: 2,
  },
  modalTitle: {
    fontSize: 14, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: font.display,
    fontWeight: "900", color: colors.onSurface, marginBottom: 6,
  },
  modalMeta: { fontSize: 13, fontFamily: font.display, color: colors.muted, marginBottom: spacing.md },
  modalConfirmMsg: {
    fontSize: 15, fontFamily: font.display, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.sm,
  },
  modalBtn: {
    borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: 14, paddingHorizontal: spacing.md,
    marginBottom: spacing.sm, backgroundColor: colors.surface,
  },
  modalBtnLast: { marginBottom: 0 },
  modalBtnText: { fontSize: 14, fontFamily: font.display, fontWeight: "800", letterSpacing: 0.5, color: colors.onSurface, textAlign: "center" },
  modalBtnDanger: { color: "#B91C1C" },
  modalDeleteFull: { backgroundColor: "#B91C1C", borderColor: "#7F1D1D", marginBottom: spacing.sm },
  actionErr: { color: "#B91C1C", fontFamily: font.display, fontWeight: "700", marginBottom: spacing.sm },
});
