import { useCallback, useEffect, useState } from "react";
import {
  Alert, FlatList, Modal, Pressable,
  RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Staff } from "@/src/api";
import { KeyboardFormAvoid } from "@/src/components/KeyboardForm";
import { Button, Empty, Input } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";

export default function StaffScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Staff[] | null>(null);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setItems(await api.get<Staff[]>("/staff"));
    } catch (e: any) {
      if (e?.status === 403) {
        Alert.alert("Owner only", "Only shop owners can manage staff.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      }
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null); setName(""); setUsername(""); setPassword(""); setError(null); setModalOpen(true);
  };
  const openEdit = (s: Staff) => {
    setEditing(s); setName(s.name); setUsername(s.username); setPassword(""); setError(null); setModalOpen(true);
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError("Name required"); return; }
    if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username.trim())) {
      setError("Username must be 3-50 chars: letters, numbers, _ . -"); return;
    }
    if (!editing && password.length < 6) { setError("Password must be at least 6 characters"); return; }
    try {
      setSaving(true);
      const body: any = { name: name.trim(), username: username.trim().toLowerCase() };
      if (password) body.password = password;
      if (editing) await api.put(`/staff/${editing.id}`, body);
      else await api.post("/staff", body);
      setModalOpen(false); await load();
    } catch (e: any) {
      setError(e?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!editing) return;
    Alert.alert("Remove staff?", `${editing.name} will no longer be able to log in.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive", onPress: async () => {
          try {
            await api.del(`/staff/${editing.id}`);
            setModalOpen(false); await load();
          } catch (e: any) {
            setError(e?.detail || "Failed to remove");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="staff-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>STAFF ACCOUNTS</Text>
          <Text style={styles.sub}>Counter logins for this shop</Text>
        </View>
        <Pressable style={styles.addBtn} onPress={openAdd} testID="staff-add">
          <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.addBtnText}>ADD</Text>
        </Pressable>
      </View>

      <FlatList
        data={items || []}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={
          loading ? null : (
            <Empty
              title="No staff yet"
              subtitle="Add a counter staff member. They can scan QR & update receiver names."
              testID="staff-empty"
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`staff-row-${item.id}`}
            onPress={() => openEdit(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceSecondary }]}
          >
            <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>@{item.username} · {item.role.toUpperCase()}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}
      />

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardFormAvoid style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setModalOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editing ? "EDIT STAFF" : "ADD STAFF"}</Text>
              <Pressable onPress={() => setModalOpen(false)} hitSlop={12}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <View style={{ padding: spacing.lg }}>
              <Input label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="e.g. Ramesh Kumar" testID="staff-name" />
              <Input
                label="Username"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="lowercase, no spaces"
                testID="staff-username"
              />
              <Input
                label={editing ? "New password (leave blank to keep)" : "Password"}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder={editing ? "•••••• (unchanged)" : "min 6 chars"}
                testID="staff-password"
              />
              {error ? <Text style={styles.err}>{error}</Text> : null}
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                {editing && (
                  <Button label="REMOVE" variant="danger" onPress={remove} testID="staff-remove" style={{ flex: 1 }} />
                )}
                <Button label={editing ? "SAVE" : "ADD"} onPress={save} loading={saving} testID="staff-save" style={{ flex: 2 }} />
              </View>
            </View>
          </View>
        </KeyboardFormAvoid>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
  },
  title: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  sub: { fontSize: 11, color: colors.muted, fontFamily: font.display, letterSpacing: 1, fontWeight: "700" },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: colors.brand,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  addBtnText: { color: colors.onBrandPrimary, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 12 },

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
  meta: { fontSize: 12, color: colors.muted, fontFamily: font.mono, marginTop: 2 },

  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet: { backgroundColor: colors.surface, borderTopWidth: 2, borderColor: colors.borderStrong, paddingBottom: spacing.xl },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 1 },
  err: { color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error, padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700" },
});
