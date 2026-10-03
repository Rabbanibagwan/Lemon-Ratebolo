/**
 * CHART — Live Auction Vendor Purchase Board.
 * All vendors + purchases for the global working date in one horizontally scrollable view.
 * Data: Action Diary lots/sales (same source as Vendor Bills). Not a graph.
 */
import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Lot } from "@/src/api";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { DatePickerModal } from "@/src/components/DatePickerModal";
import { Empty } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";
import {
  buildVendorPurchaseChart,
  filterVendorPurchaseChart,
  formatChartPurchaseLine,
  formatChartRate,
  type ChartVendorColumn,
} from "@/src/utils/vendor-purchase-chart";

const COL_WIDTH = 148;

export default function VendorPurchaseChartScreen() {
  const router = useRouter();
  const { workingDate, workingDateISO, displayDate, setWorkingDate } = useWorkingDate();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const rows = await api.get<Lot[]>(`/lots?date=${workingDateISO}`);
      setLots(rows || []);
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  }, [workingDateISO]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const chart = useMemo(
    () => filterVendorPurchaseChart(buildVendorPurchaseChart(lots, workingDateISO), q),
    [lots, workingDateISO, q],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="chart-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>CHART</Text>
          <Pressable
            onPress={() => setShowPicker(true)}
            style={styles.dateTap}
            testID="chart-date-picker"
          >
            <Text style={styles.headerSub}>Working Date: {displayDate}</Text>
            <Ionicons name="calendar-outline" size={13} color={colors.onSurface} />
          </Pressable>
        </View>
        <Pressable onPress={load} hitSlop={12} testID="chart-refresh" style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color={colors.onSurface} />
        </Pressable>
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
          title="WORKING DATE"
          maximumDate={new Date(2100, 11, 31)}
        />
      ) : null}

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Vendor, farmer, or lot"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="characters"
          testID="chart-search"
        />
        {q ? (
          <Pressable onPress={() => setQ("")} hitSlop={8} testID="chart-search-clear">
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.hint}>
        Live auction board · {chart.total_vendors} vendor{chart.total_vendors === 1 ? "" : "s"} · swipe
        for more
      </Text>

      {!chart.vendors.length ? (
        <Empty
          title="No vendor purchases"
          subtitle={`No Action Diary sales for ${displayDate}. Add lots to see the Chart.`}
          testID="chart-empty"
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          testID="chart-scroll-vertical"
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.boardRow}
            testID="chart-board"
          >
            {chart.vendors.map((col) => (
              <VendorColumn key={col.vendor_id} col={col} />
            ))}
          </ScrollView>

          <View style={styles.summary} testID="chart-summary">
            <Text style={styles.summaryTitle}>DAY TOTALS</Text>
            <SummaryLine label="TOTAL VENDORS" value={String(chart.total_vendors)} />
            <SummaryLine label="TOTAL BAGS" value={String(chart.total_bags)} />
            <SummaryLine label="TOTAL PURCHASE VALUE" value={money(chart.total_amount)} />
            <SummaryLine
              label="OVERALL AVG RATE"
              value={`₹${formatChartRate(chart.overall_avg_rate)}`}
              emphasize
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function VendorColumn({ col }: { col: ChartVendorColumn }) {
  return (
    <View style={styles.column} testID={`chart-vendor-${col.vendor_id}`}>
      <Text style={styles.vendorName} numberOfLines={2}>
        {col.vendor_name.toUpperCase()}
      </Text>
      <View style={styles.colBody}>
        {col.rows.map((r, i) => (
          <Text
            key={`${r.lot_id}-${i}-${r.bags}-${r.rate}`}
            style={styles.purchaseLine}
            numberOfLines={2}
          >
            {formatChartPurchaseLine(r, { includeLot: true, maxLen: 26 })}
          </Text>
        ))}
      </View>
      <View style={styles.colRule} />
      <Text style={styles.colTotal} testID={`chart-vendor-total-${col.vendor_id}`}>
        {col.total_bags} Avg {formatChartRate(col.avg_rate)}
      </Text>
    </View>
  );
}

function SummaryLine({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, emphasize && styles.summaryEmph]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  headerTitle: {
    fontFamily: font.display,
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 1.5,
    color: colors.onSurface,
  },
  headerSub: {
    fontFamily: font.display,
    fontSize: 12,
    fontWeight: "700",
    color: colors.onSurfaceTertiary,
    marginTop: 2,
  },
  dateTap: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  refreshBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: font.display,
    fontSize: 14,
    fontWeight: "700",
    color: colors.onSurface,
    padding: 0,
  },
  hint: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    fontFamily: font.display,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: colors.muted,
    textTransform: "uppercase",
  },
  boardRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  column: {
    width: COL_WIDTH,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    minHeight: 160,
  },
  vendorName: {
    fontFamily: font.display,
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.6,
    color: colors.onSurface,
    marginBottom: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
    paddingBottom: 6,
  },
  colBody: { flexGrow: 1, gap: 4, minHeight: 48 },
  purchaseLine: {
    fontFamily: font.mono,
    fontSize: 12,
    fontWeight: "700",
    color: colors.onSurface,
    lineHeight: 16,
  },
  colRule: {
    height: 2,
    backgroundColor: colors.borderStrong,
    marginTop: spacing.sm,
    marginBottom: 6,
  },
  colTotal: {
    fontFamily: font.display,
    fontWeight: "900",
    fontSize: 13,
    color: colors.onSurface,
    letterSpacing: 0.3,
  },
  summary: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    gap: 6,
  },
  summaryTitle: {
    fontFamily: font.display,
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.muted,
    marginBottom: 4,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  summaryLabel: {
    fontFamily: font.display,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: colors.onSurfaceTertiary,
    flexShrink: 1,
  },
  summaryValue: {
    fontFamily: font.mono,
    fontSize: 14,
    fontWeight: "800",
    color: colors.onSurface,
  },
  summaryEmph: { fontSize: 16, fontWeight: "900" },
});
