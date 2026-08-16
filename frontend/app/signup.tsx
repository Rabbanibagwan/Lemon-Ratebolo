import { useState } from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { apiErrorMessage } from "@/src/api";
import { KeyboardFormScroll } from "@/src/components/KeyboardForm";
import { Button, Input } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";

export default function Signup() {
  const { signup } = useAuth();
  const router = useRouter();
  const [shopName, setShopName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!shopName.trim() || !username.trim() || !password) {
      setError("All fields are required");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username.trim())) {
      setError("Username can only contain letters, numbers, _ . -");
      return;
    }
    try {
      setLoading(true);
      await signup(shopName.trim(), username.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(apiErrorMessage(e, "Signup failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardFormScroll contentContainerStyle={styles.scroll}>
        <View>
          <Text style={styles.title}>CREATE SHOP</Text>
          <Text style={styles.subtitle}>Register your merchant account</Text>
        </View>

        <View style={styles.card}>
          <Input
            label="Shop Name"
            value={shopName}
            onChangeText={setShopName}
            placeholder="e.g. Sri Ram Traders"
            autoCapitalize="words"
            testID="signup-shop-input"
            returnKeyType="next"
          />
          <Input
            label="Username"
            value={username}
            onChangeText={setUsername}
            placeholder="lowercase, no spaces"
            autoCapitalize="none"
            autoCorrect={false}
            testID="signup-username-input"
            returnKeyType="next"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="min 6 chars"
            secureTextEntry
            testID="signup-password-input"
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Button
            label="CREATE SHOP"
            onPress={onSubmit}
            loading={loading}
            testID="signup-submit-button"
            style={{ marginTop: spacing.sm }}
          />

          <View style={styles.footRow}>
            <Text style={styles.footText}>Already have an account? </Text>
            <Pressable onPress={() => router.replace("/login")} testID="signup-goto-login">
              <Text style={styles.footLink}>SIGN IN →</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardFormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  // flex-start (not center) so Android can scroll the focused field above the keyboard
  scroll: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: 80, flexGrow: 1, gap: spacing.xl },
  title: { fontSize: 32, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -1 },
  subtitle: { fontSize: 13, color: colors.muted, fontFamily: font.display, letterSpacing: 2, textTransform: "uppercase", marginTop: 4 },
  card: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.lg, backgroundColor: colors.surface },
  err: {
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700",
  },
  footRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: spacing.lg },
  footText: { color: colors.muted, fontFamily: font.display },
  footLink: { color: colors.brandPrimary, fontWeight: "800", fontFamily: font.display, letterSpacing: 1 },
});
