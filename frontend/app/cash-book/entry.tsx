import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { DatePickerModal } from "@/src/components/DatePickerModal";
import { Button, Input } from "@/src/components/ui";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { colors, font, spacing } from "@/src/theme";
import { formatDisplayDate, parseISODate, toISODate } from "@/src/utils/date";
import { routeParam } from "@/src/utils/route-params";
import {
  addCashBookEntry,
  getCashBookEntryById,
  updateCashBookEntry,
  type CashBookSide,
} from "@/src/utils/cash-book-store";

export default function CashBookEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ side?: string; id?: string }>();
  const sideParam = (routeParam(params.side) || "CREDIT").toUpperCase();
  const editId = routeParam(params.id) || "";
  const isEdit = !!editId;
  const sideFromParam: CashBookSide = sideParam === "DEBIT" ? "DEBIT" : "CREDIT";

  const { workingDateISO, displayDate: workingDisplay } = useWorkingDate();
  const [side, setSide] = useState<CashBookSide>(sideFromParam);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [entryDateISO, setEntryDateISO] = useState(workingDateISO);
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingEdit(true);
        const existing = await getCashBookEntryById(editId);
        if (cancelled) return;
        if (!existing) {
          setError("Entry not found");
          return;
        }
        setSide(existing.side);
        setAmount(String(existing.amount));
        setDescription(existing.description);
        setEntryDateISO(existing.date);
      } catch {
        if (!cancelled) setError("Could not load entry");
      } finally {
        if (!cancelled) setLoadingEdit(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit, editId]);

  const entryDate = useMemo(() => parseISODate(entryDateISO), [entryDateISO]);
  const entryDisplay = useMemo(
    () => (entryDateISO === workingDateISO ? workingDisplay : formatDisplayDate(entryDate)),
    [entryDateISO, workingDateISO, workingDisplay, entryDate],
  );

  const save = async () => {
    setError(null);
    const n = Number(amount);
    if (!(n > 0)) {
      setError("Enter amount");
      return;
    }
    if (!description.trim()) {
      setError("Enter description");
      return;
    }
    if (!isEdit && !entryDateISO) {
      setError("Select date");
      return;
    }
    try {
      setSaving(true);
      if (isEdit) {
        // Date/side stay locked to this entry's original day.
        await updateCashBookEntry(editId, {
          amount: n,
          description: description.trim(),
        });
      } else {
        await addCashBookEntry({
          side,
          amount: n,
          description: description.trim(),
          date: entryDateISO,
        });
      }
      router.back();
    } catch (e: any) {
      const msg = e?.message || "Could not save entry";
      setError(msg);
      Alert.alert("Cash Book", msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="cash-book-entry-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{isEdit ? `EDIT ${side}` : `${side} ENTRY`}</Text>
      </View>

      {!isEdit && showPicker ? (
        <DatePickerModal
          visible={showPicker}
          value={entryDate}
          onCancel={() => setShowPicker(false)}
          onApply={(d) => {
            setShowPicker(false);
            if (d) setEntryDateISO(toISODate(d));
          }}
          title="ENTRY DATE"
          maximumDate={new Date(2100, 11, 31)}
        />
      ) : null}

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {loadingEdit ? (
          <Text style={styles.hint}>Loading entry…</Text>
        ) : (
          <>
            <Input
              label="AMOUNT ₹"
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
              placeholder="0"
              testID="cash-book-amount"
            />
            <Input
              label="DESCRIPTION"
              value={description}
              onChangeText={setDescription}
              placeholder={side === "CREDIT" ? "e.g. Cash Sale" : "e.g. Hamali"}
              testID="cash-book-description"
            />

            <Text style={styles.label}>DATE</Text>
            {isEdit ? (
              <View style={styles.dateBox} testID="cash-book-entry-date">
                <Text style={styles.dateVal}>{entryDisplay}</Text>
              </View>
            ) : (
              <Pressable
                style={styles.dateBox}
                onPress={() => setShowPicker(true)}
                testID="cash-book-entry-date"
              >
                <Text style={styles.dateVal}>{entryDisplay}</Text>
                <Ionicons name="calendar-outline" size={16} color={colors.onSurface} />
              </Pressable>
            )}
            <Text style={styles.hint}>
              {isEdit
                ? "Date stays with this entry. Only amount and description can be changed."
                : "Defaults to the selected Cash Book date. Tap to change."}
            </Text>

            {error ? <Text style={styles.err}>{error}</Text> : null}
            <Button
              label={isEdit ? "SAVE CHANGES" : `SAVE ${side}`}
              onPress={save}
              loading={saving}
              testID="cash-book-save"
            />
          </>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 18, fontWeight: "900", fontFamily: font.display, color: colors.onSurface },
  label: {
    fontSize: 11, letterSpacing: 1.5, color: colors.muted, textTransform: "uppercase",
    fontFamily: font.display, fontWeight: "800", marginBottom: 6, marginTop: 4,
  },
  dateBox: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 12, paddingVertical: 14,
  },
  dateVal: { fontSize: 16, fontFamily: font.mono, fontWeight: "700", color: colors.onSurface },
  hint: { fontSize: 11, color: colors.muted, fontFamily: font.display, marginTop: 6, marginBottom: spacing.md },
  err: { color: "#B91C1C", fontFamily: font.display, fontWeight: "700", marginBottom: spacing.sm },
});
