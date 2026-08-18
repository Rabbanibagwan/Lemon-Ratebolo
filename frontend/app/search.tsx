import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Patti, VendorBill } from "@/src/api";
import { Empty, Input } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";

type Tab = "farmer" | "vendor";

/**
 * Global Dashboard search — independent of working date.
 * Farmer: all-date Pattis by Patti/Bill No. or Farmer Name.
 * Vendor: all-date Vendor Bills by Bill No. or Vendor Name.
 * Opens existing Patti / Vendor Bill preview screens (Print + Share already there).
 */
export default function SearchScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("farmer");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [pattis, setPattis] = useState<Patti[]>([]);
  const [bills, setBills] = useState<VendorBill[]>([]);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);

  const runSearch = useCallback(async (tabNow: Tab, qRaw: string) => {
    const q = qRaw.trim();
    if (!q) {
      setPattis([]);
      setBills([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setSearched(true);
    try {
      if (tabNow === "farmer") {
        // No date param → all historical pattis matching q
        const rows = await api.get<Patti[]>(`/pattis?q=${encodeURIComponent(q)}&limit=100`);
        if (id === reqId.current) setPattis(rows || []);
      } else {
        // No date param → all historical vendor bills matching q
        const rows = await api.get<VendorBill[]>(`/vendor-bills?q=${encodeURIComponent(q)}&limit=100`);
        if (id === reqId.current) setBills(rows || []);
      }
    } catch {
      if (id === reqId.current) {
        if (tabNow === "farmer") setPattis([]);
        else setBills([]);
      }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(tab, query);
    }, 280);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, tab, runSearch]);

  const placeholder =
    tab === "farmer"
      ? "Search Patti/Bill No. or Farmer Name…"
      : "Search Vendor Bill No. or Vendor Name…";

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="search-back">
          <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
          <Text style={styles.backText}>HOME</Text>
        </Pressable>
        <Text style={styles.title}>SEARCH</Text>
        <Text style={styles.sub}>All dates · global</Text>
      </View>

      <View style={styles.segRow}>
        <Seg
          label="FARMER"
          active={tab === "farmer"}
          onPress={() => setTab("farmer")}
          testID="search-tab-farmer"
        />
        <Seg
          label="VENDOR"
          active={tab === "vendor"}
          onPress={() => setTab("vendor")}
          testID="search-tab-vendor"
        />
      </View>

      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <Input
          placeholder={placeholder}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          testID="search-input"
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : tab === "farmer" ? (
        <FlatList
          data={pattis}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100, paddingTop: 0 }}
          ListEmptyComponent={
            !searched ? (
              <Empty
                title="Search farmers"
                subtitle="Type a Patti/Bill No. or Farmer Name. Results include every date."
                testID="search-farmer-hint"
              />
            ) : (
              <Empty title="No pattis found" subtitle="Try another number or name." testID="search-farmer-empty" />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/patti/${item.id}`)}
              testID={`search-patti-${item.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  #{item.patti_no} · {item.farmer_name || "—"}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {item.date || "—"}
                  {(item.lots || []).length
                    ? ` · Lot ${(item.lots || []).map((l) => l.lot_no).filter(Boolean).join(", ")}`
                    : ""}
                  {` · ${item.total_bags || 0} bags`}
                </Text>
              </View>
              <Text style={styles.rowAmount}>{money(item.net_payable || 0)}</Text>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={bills}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: 100, paddingTop: 0 }}
          ListEmptyComponent={
            !searched ? (
              <Empty
                title="Search vendors"
                subtitle="Type a Vendor Bill No. or Vendor Name. Results include every date."
                testID="search-vendor-hint"
              />
            ) : (
              <Empty title="No bills found" subtitle="Try another bill no. or name." testID="search-vendor-empty" />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/vendor-bill/${item.id}`)}
              testID={`search-bill-${item.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.bill_code} · {item.vendor_name || "—"}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {item.date || "—"}
                  {` · ${item.total_bags || 0} bags`}
                </Text>
              </View>
              <Text style={styles.rowAmount}>{money(item.grand_total || 0)}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
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
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, marginBottom: 4 },
  backText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.onSurface,
    fontFamily: font.display,
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    color: colors.onSurface,
    fontFamily: font.display,
    letterSpacing: -0.5,
  },
  sub: { fontSize: 12, color: colors.muted, fontFamily: font.mono, fontWeight: "700", marginTop: 2 },
  segRow: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  seg: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  segActive: { backgroundColor: colors.surfaceInverse },
  segText: {
    fontFamily: font.display,
    fontWeight: "900",
    letterSpacing: 1,
    fontSize: 12,
    color: colors.onSurface,
  },
  segTextActive: { color: colors.onSurfaceInverse },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl },
  row: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  rowTitle: {
    fontFamily: font.display,
    fontWeight: "900",
    fontSize: 15,
    color: colors.onSurface,
    letterSpacing: 0.2,
  },
  rowMeta: {
    fontFamily: font.mono,
    fontSize: 11,
    color: colors.muted,
    marginTop: 3,
    fontWeight: "700",
  },
  rowAmount: {
    fontFamily: font.mono,
    fontWeight: "800",
    fontSize: 14,
    color: colors.brandPrimary,
  },
});
