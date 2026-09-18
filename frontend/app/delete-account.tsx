import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api, apiErrorMessage } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { Button, Input } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";
import { clearAccountLocalData } from "@/src/utils/clear-account-local";

type DeleteAccountOut = {
  deleted: boolean;
  shop_id: string;
  deleted_collections: string[];
  drive_backups_deleted: boolean;
  message: string;
};

const CONFIRM_PHRASE = "DELETE";

export default function DeleteAccountScreen() {
  const { session, logout } = useAuth();
  const router = useRouter();
  const isOwner = session?.role === "owner";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    if (!isOwner) {
      Alert.alert("Owner only", "Only the shop owner can delete this account.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  }, [session, isOwner, router]);

  const openFirstConfirm = useCallback(() => {
    if (!isOwner) return;
    Alert.alert(
      "Delete Account",
      "This permanently deletes your Lemon Mandi account and associated merchant data from Lemon Mandi servers.\n\nSome Google Drive backup files may remain in your Google Drive and must be deleted separately.\n\nThis cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: () => {
            setPhrase("");
            setError(null);
            setConfirmOpen(true);
          },
        },
      ],
    );
  }, [isOwner]);

  const cancelConfirm = () => {
    if (working) return;
    setConfirmOpen(false);
    setPhrase("");
    setError(null);
  };

  const executeDelete = async () => {
    if (!isOwner || working) return;
    if (phrase.trim() !== CONFIRM_PHRASE) {
      setError(`Type ${CONFIRM_PHRASE} to confirm.`);
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const res = await api.post<DeleteAccountOut>("/auth/delete-account", {
        confirm: CONFIRM_PHRASE,
      });
      if (!res?.deleted) {
        setError("Deletion did not complete. Please try again.");
        setWorking(false);
        return;
      }
      // Never claim Drive files were deleted.
      const driveNote =
        res.drive_backups_deleted === true
          ? ""
          : "\n\nGoogle Drive backup files were not deleted. Remove Lemon Mandi backup files from your Google Drive if you no longer need them.";
      setConfirmOpen(false);
      await clearAccountLocalData();
      await logout();
      Alert.alert(
        "Account deleted",
        `${res.message || "Your Lemon Mandi account has been deleted."}${driveNote}`,
        [{ text: "OK", onPress: () => router.replace("/login") }],
      );
    } catch (e) {
      setError(apiErrorMessage(e, "Could not delete account"));
      setWorking(false);
    }
  };

  if (!isOwner) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} testID="delete-account-back">
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>DELETE ACCOUNT</Text>
        </View>
        <View style={{ padding: spacing.lg }}>
          <Text style={styles.body}>Only the shop owner can delete this account.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="delete-account-back" hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>DELETE ACCOUNT</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.warningTitle}>Permanent deletion</Text>
        <Text style={styles.body}>
          This permanently deletes your Lemon Mandi account and associated merchant data from Lemon
          Mandi servers.
        </Text>
        <Text style={[styles.body, { marginTop: spacing.md }]}>
          Some Google Drive backup files may remain in your Google Drive and must be deleted
          separately.
        </Text>
        <Text style={[styles.body, { marginTop: spacing.md, fontWeight: "800" }]}>
          This cannot be undone.
        </Text>

        {error && !confirmOpen ? <Text style={styles.err}>{error}</Text> : null}

        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          <Button
            label="DELETE ACCOUNT"
            variant="danger"
            onPress={openFirstConfirm}
            testID="delete-account-start"
          />
          <Button label="CANCEL" variant="secondary" onPress={() => router.back()} testID="delete-account-cancel" />
        </View>
      </View>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={cancelConfirm}>
        <View style={styles.overlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Confirm deletion</Text>
            <Text style={styles.overlayBody}>
              Type {CONFIRM_PHRASE} to permanently delete this merchant account. Google Drive backups
              are not deleted automatically.
            </Text>
            <Input
              label={`Type ${CONFIRM_PHRASE}`}
              value={phrase}
              onChangeText={setPhrase}
              autoCapitalize="characters"
              autoCorrect={false}
              testID="delete-account-confirm-phrase"
            />
            {error ? <Text style={styles.err}>{error}</Text> : null}
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label="DELETE ACCOUNT"
                variant="danger"
                onPress={executeDelete}
                loading={working}
                disabled={working || phrase.trim() !== CONFIRM_PHRASE}
                testID="delete-account-confirm"
              />
              <Button label="CANCEL" variant="secondary" onPress={cancelConfirm} disabled={working} testID="delete-account-confirm-cancel" />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: colors.onSurface,
    fontFamily: font.display,
    letterSpacing: -0.5,
  },
  content: { padding: spacing.lg },
  warningTitle: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.error,
    textTransform: "uppercase",
    fontFamily: font.display,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  body: { fontSize: 14, color: colors.onSurface, fontFamily: font.display, lineHeight: 20 },
  err: {
    color: colors.error,
    backgroundColor: "#FEE2E2",
    borderWidth: 2,
    borderColor: colors.error,
    padding: spacing.sm,
    marginTop: spacing.sm,
    fontFamily: font.display,
    fontWeight: "700",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  confirmBox: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.error,
    padding: spacing.lg,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.error,
    fontFamily: font.display,
    marginBottom: spacing.sm,
  },
  overlayBody: {
    fontSize: 13,
    color: colors.onSurface,
    fontFamily: font.display,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
});
