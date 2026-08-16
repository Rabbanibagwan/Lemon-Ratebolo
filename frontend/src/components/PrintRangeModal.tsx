import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { KeyboardFormAvoid } from "@/src/components/KeyboardForm";
import { colors, font, spacing } from "@/src/theme";

type Props = {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (from: number, to: number) => void;
  /** Suggested defaults — usually min & max patti_no in the visible list. */
  suggestedFrom?: number;
  suggestedTo?: number;
  /** Optional cap so the user doesn't type nonsense. */
  minAllowed?: number;
  maxAllowed?: number;
  title?: string;
  countHint?: string;
};

/**
 * Ask the user for a Patti Number range (From / To) before printing.
 * Explicit Cancel and Print buttons; safe defaults so a one-tap Print works.
 */
export function PrintRangeModal({
  visible, onCancel, onConfirm,
  suggestedFrom, suggestedTo, minAllowed, maxAllowed,
  title = "PRINT PATTI RANGE",
  countHint,
}: Props) {
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setFrom(suggestedFrom != null ? String(suggestedFrom) : "");
      setTo(suggestedTo != null ? String(suggestedTo) : "");
      setErr(null);
    }
  }, [visible, suggestedFrom, suggestedTo]);

  const submit = () => {
    setErr(null);
    const f = parseInt(from.trim(), 10);
    const t = parseInt(to.trim(), 10);
    if (!Number.isFinite(f) || f <= 0) { setErr("Enter a valid FROM patti number."); return; }
    if (!Number.isFinite(t) || t <= 0) { setErr("Enter a valid TO patti number."); return; }
    if (t < f) { setErr("TO must be greater than or equal to FROM."); return; }
    if (minAllowed != null && f < minAllowed) { setErr(`FROM cannot be less than ${minAllowed}.`); return; }
    if (maxAllowed != null && t > maxAllowed) { setErr(`TO cannot be greater than ${maxAllowed}.`); return; }
    onConfirm(f, t);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <KeyboardFormAvoid style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} testID="print-range-backdrop" />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onCancel} hitSlop={14} testID="print-range-close">
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.body}>
            <Text style={styles.hint}>
              Enter the range of Patti Numbers to send to the thermal printer.
              {countHint ? `\n${countHint}` : ""}
            </Text>

            <View style={styles.row}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>FROM #</Text>
                <TextInput
                  value={from}
                  onChangeText={(t) => setFrom(t.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder={suggestedFrom != null ? String(suggestedFrom) : "e.g. 1"}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  testID="print-range-from"
                  autoFocus
                />
              </View>
              <Ionicons name="arrow-forward" size={18} color={colors.muted} style={{ alignSelf: "center" }} />
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>TO #</Text>
                <TextInput
                  value={to}
                  onChangeText={(t) => setTo(t.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder={suggestedTo != null ? String(suggestedTo) : "e.g. 10"}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  testID="print-range-to"
                />
              </View>
            </View>

            {err ? <Text style={styles.err}>{err}</Text> : null}
          </View>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnCancel, pressed && { opacity: 0.85 }]}
              onPress={onCancel}
              testID="print-range-cancel"
            >
              <Text style={[styles.btnText, { color: colors.onSurface }]}>CANCEL</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnPrint, pressed && { opacity: 0.85 }]}
              onPress={submit}
              testID="print-range-print"
            >
              <Ionicons name="print" size={16} color={colors.onBrandPrimary} />
              <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>PRINT</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardFormAvoid>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(17,24,39,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 2, borderTopColor: colors.borderStrong,
    borderLeftWidth: 2, borderLeftColor: colors.borderStrong,
    borderRightWidth: 2, borderRightColor: colors.borderStrong,
    paddingBottom: spacing.lg,
  },
  head: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.lg, borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  title: { fontFamily: font.display, fontWeight: "900", fontSize: 14, letterSpacing: 1, color: colors.onSurface },
  body: { padding: spacing.lg, gap: spacing.md },
  hint: { fontSize: 12, color: colors.muted, fontFamily: font.display, lineHeight: 16 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  field: { flex: 1, gap: 4 },
  fieldLabel: { fontFamily: font.display, fontWeight: "800", letterSpacing: 1, fontSize: 10, color: colors.muted },
  input: {
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontFamily: font.mono, fontSize: 16, color: colors.onSurface, minHeight: 48,
  },
  err: { color: colors.error, fontFamily: font.display, fontWeight: "700", fontSize: 12 },
  actions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  btn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 2, paddingVertical: 14, minHeight: 48,
  },
  btnCancel: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  btnPrint: { borderColor: colors.brand, backgroundColor: colors.brandPrimary },
  btnText: { fontFamily: font.display, fontWeight: "900", letterSpacing: 0.5, fontSize: 12 },
});
