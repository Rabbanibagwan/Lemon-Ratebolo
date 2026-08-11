import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Vendor, VendorDashboard } from "@/src/api";
import { colors, font, money, spacing } from "@/src/theme";
import { Empty } from "@/src/components/ui";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { DatePickerModal } from "@/src/components/DatePickerModal";

type Row = Vendor & { dash?: VendorDashboard };

export default function VendorsList() {
  const router = useRouter();
  const { workingDate, displayDate, isWorkingToday, setWorkingDate } = useWorkingDate();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const vs = await api.get<Vendor[]>("/vendors");
      // Fetch dashboards in parallel (best effort — limit to first 40 to avoid overload)
      const dashes = await Promise.all(
        vs.slice(0, 40).map((v) => api.get<VendorDashboard>(`/vendors/${v.id}/dashboard`).catch(() => null)),
      );
      const merged: Row[] = vs.map((v, i) => ({ ...v, dash: dashes[i] || undefined }));
      // Sort: outstanding desc, then name asc
      merged.sort((a, b) => (b.dash?.outstanding ?? 0) - (a.dash?.outstanding ?? 0) || a.name.localeCompare(b.name));
      setRows(merged);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? rows.filter((r) =>
          r.name.toLowerCase().includes(s)
          || (r.details || "").toLowerCase().includes(s)
          || (r.phone || "").includes(s))
      : rows;
  }, [rows, q]);

  const totalOutstanding = useMemo(
    () => rows.reduce((s, r) => s + (r.dash?.outstanding || 0), 0),
    [rows],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="vendors-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>VENDORS</Text>
          <Pressable
            onPress={() => setShowPicker(true)}
            style={styles.dateTap}
            testID="vendors-date-picker"
          >
            <Text style={styles.headerSub}>
              {isWorkingToday ? `Today · ${displayDate}` : `Working · ${displayDate}`}
            </Text>
            <Ionicons name="calendar-outline" size={13} color={colors.onSurface} />
          </Pressable>
        </View>
        <View style={styles.outBox}>
          <Text style={styles.outLabel}>DUE</Text>
          <Text style={styles.outValue} numberOfLines={1} adjustsFontSizeToFit>{money(totalOutstanding)}</Text>
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
          title="WORKING DATE"
          maximumDate={new Date(2100, 11, 31)}
        />
      ) : null}

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search name, details, phone…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          testID="vendors-search"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          <Empty title="No vendors yet" subtitle="Add vendors from the auction book." />
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push({ pathname: "/vendor/[id]", params: { id: item.id } })}
            testID={`vendor-row-${item.id}`}
          >
            <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              {item.details ? <Text style={styles.meta} numberOfLines={1}>{item.details}</Text> : null}
              <Text style={styles.meta}>
                {item.dash ? `${item.dash.total_bills} bills · ${item.dash.total_bags} bags` : "—"}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[styles.due, (item.dash?.outstanding || 0) > 0 && styles.dueOn]}>
                {money(item.dash?.outstanding || 0)}
              </Text>
              <Text style={styles.dueLbl}>DUE</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: colors.muted, letterSpacing: 1, fontWeight: "700" },
  dateTap: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2, alignSelf: "flex-start" },
  outBox: { borderWidth: 2, borderColor: colors.onSurface, paddingHorizontal: 10, paddingVertical: 6, alignItems: "flex-end", minWidth: 90, backgroundColor: colors.surfaceInverse },
  outLabel: { fontSize: 9, letterSpacing: 1, color: "#9CA3AF", fontWeight: "800" },
  outValue: { fontSize: 15, fontFamily: font.mono, color: colors.onSurfaceInverse, fontWeight: "800" },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 15 },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface,
  },
  avatar: {
    width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSecondary,
  },
  avatarText: { fontSize: 16, fontWeight: "900", color: colors.onBrandSecondary, fontFamily: font.display },
  name: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  meta: { fontSize: 11, color: colors.muted, marginTop: 2, fontFamily: font.mono },
  due: { fontSize: 14, fontWeight: "800", fontFamily: font.mono, color: colors.muted },
  dueOn: { color: colors.error },
  dueLbl: { fontSize: 9, letterSpacing: 1, color: colors.muted, fontWeight: "800" },
});
