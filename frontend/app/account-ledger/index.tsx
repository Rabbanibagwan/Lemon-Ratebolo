import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, LedgerAccountType, LedgerParty } from "@/src/api";
import { colors, font, money, spacing } from "@/src/theme";
import { Empty } from "@/src/components/ui";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { DatePickerModal } from "@/src/components/DatePickerModal";

export default function AccountLedgerHome() {
  const router = useRouter();
  const { workingDate, workingDateISO, displayDate, setWorkingDate } = useWorkingDate();
  const [tab, setTab] = useState<LedgerAccountType>("FARMER");
  const [rows, setRows] = useState<LedgerParty[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const qs = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : "";
      const data = await api.get<LedgerParty[]>(
        `/account-ledger/parties?account_type=${tab}&date=${workingDateISO}${qs}`,
      );
      setRows(data);
    } catch (e) {
      setRows([]);
      console.warn("Ledger parties failed", e);
    } finally {
      setLoading(false);
    }
  }, [tab, workingDateISO, q]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="ledger-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>ACCOUNT LEDGER</Text>
          <Pressable onPress={() => setShowPicker(true)} style={styles.dateTap} testID="ledger-date-picker">
            <Text style={styles.headerSub}>{displayDate}</Text>
            <Ionicons name="calendar-outline" size={13} color={colors.onSurface} />
          </Pressable>
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

      <View style={styles.tabsRow}>
        <Pressable
          style={[styles.tabBtn, tab === "FARMER" && styles.tabBtnOn]}
          onPress={() => { setTab("FARMER"); setQ(""); }}
          testID="ledger-tab-farmer"
        >
          <Text style={[styles.tabText, tab === "FARMER" && styles.tabTextOn]}>FARMER</Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, tab === "VENDOR" && styles.tabBtnOn]}
          onPress={() => { setTab("VENDOR"); setQ(""); }}
          testID="ledger-tab-vendor"
        >
          <Text style={[styles.tabText, tab === "VENDOR" && styles.tabTextOn]}>VENDOR</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={tab === "FARMER" ? "Search farmer, village, phone…" : "Search vendor, details, phone…"}
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          testID="ledger-search"
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(x) => x.party_id}
        extraData={workingDateISO + tab}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          <Empty
            title={tab === "FARMER" ? "No farmer ledger entries" : "No vendor ledger entries"}
            subtitle={tab === "FARMER"
              ? "Manual credit/debit for this date appears here. Farmer Patti is not added automatically."
              : "Posted vendor bills, payments, and manual entries for this date appear here."}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push({
              pathname: "/account-ledger/[kind]/[id]",
              params: { kind: tab === "FARMER" ? "farmer" : "vendor", id: item.party_id },
            })}
            testID={`ledger-party-${item.party_id}`}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.party_name}</Text>
              {item.details ? <Text style={styles.meta} numberOfLines={1}>{item.details}</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.amount}>{money(item.balance)}</Text>
              <Text style={styles.meta}>{item.txn_count} txn</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}
      />

      <Pressable
        style={({ pressed }) => [styles.fab, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => router.push({ pathname: "/account-ledger/new", params: { kind: tab } })}
        testID="ledger-add-txn"
      >
        <Ionicons name="add-circle" size={20} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>ADD TRANSACTION</Text>
      </Pressable>
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
  headerTitle: { fontSize: 18, fontWeight: "900", fontFamily: font.display, letterSpacing: 0.4, color: colors.onSurface },
  headerSub: { fontSize: 13, fontFamily: font.mono, fontWeight: "700", color: colors.onSurface },
  dateTap: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  tabsRow: { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center", backgroundColor: colors.surface },
  tabBtnOn: { backgroundColor: colors.surfaceInverse },
  tabText: { fontSize: 12, fontFamily: font.display, fontWeight: "800", letterSpacing: 1.2, color: colors.muted },
  tabTextOn: { color: colors.onSurfaceInverse },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8, margin: spacing.lg, marginBottom: 0,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 10, paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.onSurface, fontFamily: font.display, paddingVertical: 4 },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface,
  },
  name: { fontSize: 16, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  meta: { fontSize: 11, color: colors.muted, marginTop: 2, fontFamily: font.display },
  amount: { fontSize: 16, fontWeight: "800", fontFamily: font.mono, color: colors.onSurface },
  fab: {
    position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg,
    backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.brand,
    paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  fabText: { color: colors.onBrandPrimary, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 14 },
});
