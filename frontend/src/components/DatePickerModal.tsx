import { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import { colors, font, spacing } from "@/src/theme";
import { formatMonthYear, sameDay, startOfDay, toISODate } from "@/src/utils/date";

type Props = {
  visible: boolean;
  value: Date | null;
  onCancel: () => void;
  onApply: (date: Date | null) => void;
  allowClear?: boolean;
  title?: string;
  maximumDate?: Date;
  minimumDate?: Date;
};

/**
 * Cross-platform date picker.
 *
 * Android — native OS dialog (reliable).
 * iOS / web — custom month calendar grid (native web picker often renders invisible).
 */
export function DatePickerModal(props: Props) {
  if (Platform.OS === "android") {
    return <AndroidDatePicker {...props} />;
  }
  return <CalendarDatePicker {...props} />;
}

function AndroidDatePicker({ visible, value, onCancel, onApply, maximumDate, minimumDate }: Props) {
  if (!visible) return null;
  return (
    <DateTimePicker
      value={value || new Date()}
      mode="date"
      display="default"
      onChange={(e: DateTimePickerEvent, d?: Date) => {
        if (e.type === "set" && d) onApply(d);
        else onCancel();
      }}
      maximumDate={maximumDate}
      minimumDate={minimumDate}
    />
  );
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function CalendarDatePicker({
  visible, value, onCancel, onApply, allowClear, title = "SELECT DATE",
  maximumDate, minimumDate,
}: Props) {
  const initial = startOfDay(value || new Date());
  const [draft, setDraft] = useState<Date>(initial);
  const [cursor, setCursor] = useState<Date>(() => new Date(initial.getFullYear(), initial.getMonth(), 1));

  useEffect(() => {
    if (!visible) return;
    const next = startOfDay(value || new Date());
    setDraft(next);
    setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
  }, [visible, value]);

  const cells = useMemo(() => buildMonthCells(cursor), [cursor]);

  const canGoPrev = !minimumDate || new Date(cursor.getFullYear(), cursor.getMonth(), 1) > startOfDay(minimumDate);
  const canGoNext = !maximumDate || new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0) < startOfDay(maximumDate);

  const isDisabled = (d: Date) => {
    if (minimumDate && d < startOfDay(minimumDate)) return true;
    if (maximumDate && d > startOfDay(maximumDate)) return true;
    return false;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} testID="date-picker-backdrop" />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onCancel} hitSlop={14} testID="date-picker-close">
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.monthNav}>
            <Pressable
              style={[styles.navBtn, !canGoPrev && styles.navDisabled]}
              disabled={!canGoPrev}
              onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              testID="date-picker-prev-month"
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
            </Pressable>
            <Text style={styles.monthLabel} testID="date-picker-month-label">{formatMonthYear(cursor)}</Text>
            <Pressable
              style={[styles.navBtn, !canGoNext && styles.navDisabled]}
              disabled={!canGoNext}
              onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              testID="date-picker-next-month"
              hitSlop={8}
            >
              <Ionicons name="chevron-forward" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={styles.weekday}>{w}</Text>
            ))}
          </View>

          <View style={styles.grid} testID="date-picker-grid">
            {cells.map((cell, idx) => {
              if (!cell) {
                return <View key={`e-${idx}`} style={styles.dayCell} />;
              }
              const disabled = isDisabled(cell);
              const selected = sameDay(cell, draft);
              const today = sameDay(cell, new Date());
              return (
                <Pressable
                  key={toISODate(cell)}
                  disabled={disabled}
                  onPress={() => setDraft(cell)}
                  style={[
                    styles.dayCell,
                    selected && styles.daySelected,
                    today && !selected && styles.dayToday,
                    disabled && styles.dayDisabled,
                  ]}
                  testID={`date-picker-day-${toISODate(cell)}`}
                >
                  <Text
                    style={[
                      styles.dayText,
                      selected && styles.dayTextSelected,
                      today && !selected && styles.dayTextToday,
                      disabled && styles.dayTextDisabled,
                    ]}
                  >
                    {cell.getDate()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.selectedHint} testID="date-picker-selected-hint">
            Selected: {draft.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
          </Text>

          <View style={styles.actions}>
            {allowClear ? (
              <Pressable
                style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.7 }]}
                onPress={() => onApply(null)}
                testID="date-picker-clear"
              >
                <Text style={[styles.btnText, { color: colors.muted }]}>CLEAR</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnCancel, pressed && { opacity: 0.85 }]}
              onPress={onCancel}
              testID="date-picker-cancel"
            >
              <Text style={[styles.btnText, { color: colors.onSurface }]}>CANCEL</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnApply, pressed && { opacity: 0.85 }]}
              onPress={() => onApply(draft)}
              testID="date-picker-apply"
            >
              <Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} />
              <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>APPLY</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function buildMonthCells(monthStart: Date): (Date | null)[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
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

  monthNav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  navBtn: {
    width: 40, height: 40, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.borderStrong,
  },
  navDisabled: { opacity: 0.3 },
  monthLabel: {
    flex: 1, textAlign: "center",
    fontFamily: font.display, fontWeight: "900", fontSize: 16, color: colors.onSurface,
  },

  weekRow: {
    flexDirection: "row", paddingHorizontal: spacing.md, marginBottom: 4,
  },
  weekday: {
    flex: 1, textAlign: "center",
    fontFamily: font.display, fontWeight: "800", fontSize: 11, letterSpacing: 0.5, color: colors.muted,
  },

  grid: {
    flexDirection: "row", flexWrap: "wrap",
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  dayCell: {
    width: "14.2857%",
    aspectRatio: 1,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "transparent",
  },
  daySelected: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brand,
  },
  dayToday: {
    borderColor: colors.borderStrong,
  },
  dayDisabled: { opacity: 0.25 },
  dayText: {
    fontFamily: font.mono, fontWeight: "800", fontSize: 15, color: colors.onSurface,
  },
  dayTextSelected: { color: colors.onBrandPrimary },
  dayTextToday: { color: colors.brandPrimary },
  dayTextDisabled: { color: colors.muted },

  selectedHint: {
    textAlign: "center",
    fontFamily: font.display, fontWeight: "700", fontSize: 13, color: colors.muted,
    marginBottom: spacing.sm, paddingHorizontal: spacing.lg,
  },

  actions: {
    flexDirection: "row", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
  },
  btn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 2, paddingVertical: 14, minHeight: 48,
  },
  btnGhost: { borderColor: colors.divider, backgroundColor: colors.surface },
  btnCancel: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  btnApply: { borderColor: colors.brand, backgroundColor: colors.brandPrimary },
  btnText: { fontFamily: font.display, fontWeight: "900", letterSpacing: 0.5, fontSize: 12 },
});
