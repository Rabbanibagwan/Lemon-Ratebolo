import { useCallback, useMemo, useState } from "react";
import {
  FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Farmer, Vendor } from "@/src/api";
import { Button, Empty, Input } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";

type Tab = "farmers" | "vendors";

export default function Directory() {
  const [tab, setTab] = useState<Tab>("farmers");
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  const [modal, setModal] = useState<null | { kind: Tab; editing?: Farmer | Vendor }>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [village, setVillage] = useState("");
  const [details, setDetails] = useState(""); // vendor-only: Shop name / Village
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [f, v] = await Promise.all([
        api.get<Farmer[]>("/farmers"),
        api.get<Vendor[]>("/vendors"),
      ]);
      setFarmers(f);
      setVendors(v);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openAdd = (kind: Tab) => {
    setModal({ kind });
    setName("");
    setPhone("");
    setVillage("");
    setDetails("");
    setError(null);
  };

  const openEdit = (kind: Tab, item: Farmer | Vendor) => {
    setModal({ kind, editing: item });
    setName(item.name);
    setPhone(item.phone || "");
    setVillage((item as Farmer).village || "");
    setDetails((item as Vendor).details || "");
    setError(null);
  };

  const close = () => setModal(null);

  const save = async () => {
    if (!modal) return;
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (modal.kind === "vendors" && !details.trim()) {
      setError("Vendor Details are required (e.g. shop name / village)");
      return;
    }
    try {
      setSaving(true);
      const body: any = { name: name.trim(), phone: phone.trim() || null };
      if (modal.kind === "farmers") {
        body.village = village.trim() || null;
      } else {
        body.details = details.trim();
      }
      const path = modal.kind === "farmers" ? "/farmers" : "/vendors";
      if (modal.editing) {
        await api.put(`${path}/${modal.editing.id}`, body);
      } else {
        await api.post(path, body);
      }
      await load();
      close();
    } catch (e: any) {
      setError(e?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!modal?.editing) return;
    try {
      setSaving(true);
      const path = modal.kind === "farmers" ? "/farmers" : "/vendors";
      await api.del(`${path}/${modal.editing.id}`);
      await load();
      close();
    } catch (e: any) {
      setError(e?.detail || "Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  const items = tab === "farmers" ? farmers : vendors;
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return items;
    return items.filter((i) =>
      i.name.toLowerCase().includes(ql)
      || (tab === "vendors" && ((i as Vendor).details || "").toLowerCase().includes(ql))
      || (i.phone || "").includes(ql)
    );
  }, [items, q]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>DIRECTORY</Text>
      </View>

      <View style={styles.segRow}>
        <SegBtn label={`FARMERS (${farmers.length})`} active={tab === "farmers"} onPress={() => setTab("farmers")} testID="seg-farmers" />
        <SegBtn label={`VENDORS (${vendors.length})`} active={tab === "vendors"} onPress={() => setTab("vendors")} testID="seg-vendors" />
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          testID="directory-search"
          value={q}
          onChangeText={setQ}
          placeholder={`Search ${tab === "farmers" ? "farmers" : "vendors"}…`}
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140, gap: spacing.sm }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          loading ? null : (
            <Empty
              title={`No ${tab === "farmers" ? "farmers" : "vendors"} yet`}
              subtitle="Tap + to add your first entry"
              testID="directory-empty"
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`dir-row-${item.id}`}
            onPress={() => openEdit(tab, item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceSecondary }]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {tab === "vendors" && (item as Vendor).details ? (item as Vendor).details : (item.phone || "—")}
                {tab === "farmers" && (item as Farmer).village ? ` · ${(item as Farmer).village}` : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}
      />

      <Pressable
        style={({ pressed }) => [styles.fab, { opacity: pressed ? 0.85 : 1 }]}
        onPress={() => openAdd(tab)}
        testID="directory-add-fab"
      >
        <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        <Text style={styles.fabText}>{tab === "farmers" ? "ADD FARMER" : "ADD VENDOR"}</Text>
      </Pressable>

      <Modal visible={!!modal} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.backdrop} onPress={close} />
          <View style={styles.modalCard} testID="directory-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {modal?.editing ? "EDIT" : "ADD"} {modal?.kind === "farmers" ? "FARMER" : "VENDOR"}
              </Text>
              <Pressable onPress={close} testID="modal-close" hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <Input
              label="Name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              placeholder="Full name"
              testID="modal-name"
            />
            {modal?.kind === "vendors" && (
              <Input
                label="Vendor Details (required)"
                value={details}
                onChangeText={setDetails}
                placeholder="e.g. MM Traders, Indi"
                autoCapitalize="words"
                testID="modal-details"
              />
            )}
            <Input
              label="Phone (optional)"
              value={phone}
              onChangeText={setPhone}
              placeholder="10-digit mobile"
              keyboardType="phone-pad"
              testID="modal-phone"
            />
            {modal?.kind === "farmers" && (
              <Input
                label="Village (optional)"
                value={village}
                onChangeText={setVillage}
                placeholder="Village / town"
                testID="modal-village"
              />
            )}

            {error ? <Text style={styles.err}>{error}</Text> : null}

            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
              {modal?.editing ? (
                <Button label="DELETE" variant="danger" onPress={remove} loading={saving} testID="modal-delete" style={{ flex: 1 }} />
              ) : null}
              <Button label={modal?.editing ? "SAVE" : "ADD"} onPress={save} loading={saving} testID="modal-save" style={{ flex: 2 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function SegBtn({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      style={[styles.seg, active && styles.segActive]}
      onPress={onPress}
    >
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  title: { fontSize: 28, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.5 },
  segRow: { flexDirection: "row", paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 0 },
  seg: {
    flex: 1, paddingVertical: 12, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", backgroundColor: colors.surface,
  },
  segActive: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  segText: { fontFamily: font.display, fontWeight: "800", letterSpacing: 1, color: colors.onSurface, fontSize: 12 },
  segTextActive: { color: colors.onSurfaceInverse },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 15, paddingVertical: 8 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface,
  },
  avatar: {
    width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSecondary,
  },
  avatarText: { fontSize: 16, fontWeight: "900", color: colors.onBrandSecondary, fontFamily: font.display },
  name: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  meta: { fontSize: 12, color: colors.muted, fontFamily: font.display, marginTop: 2 },
  fab: {
    position: "absolute", right: spacing.lg, bottom: spacing.lg + 62,
    backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.brand,
    paddingVertical: 14, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", gap: 6,
  },
  fabText: { color: colors.onBrandPrimary, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 13 },

  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  modalCard: {
    backgroundColor: colors.surface, borderTopWidth: 2, borderColor: colors.borderStrong,
    padding: spacing.lg, paddingBottom: spacing.xl,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  modalTitle: { fontSize: 18, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 0.5 },
  err: {
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700",
  },
});
