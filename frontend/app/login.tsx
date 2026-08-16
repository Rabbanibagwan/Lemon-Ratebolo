import { useState } from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { apiErrorMessage } from "@/src/api";
import { KeyboardFormScroll } from "@/src/components/KeyboardForm";
import { Button, Input } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onLogin = async () => {
    setError(null);
    if (!username.trim() || !password) {
      setError("Enter username and password");
      return;
    }
    try {
      setLoading(true);
      await login(username.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(apiErrorMessage(e, "Login failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardFormScroll contentContainerStyle={styles.scroll}>
        <View style={styles.brand}>
          <View style={styles.brandBox}>
            <Text style={styles.brandGlyph}>◤</Text>
          </View>
          <Text style={styles.title}>LEMON MANDI</Text>
          <Text style={styles.subtitle}>Merchant Billing / Patti</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in to your shop</Text>

          <Input
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="e.g. ram_traders"
            testID="login-username-input"
            returnKeyType="next"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Enter password"
            testID="login-password-input"
            returnKeyType="go"
            onSubmitEditing={onLogin}
          />

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Button
            label="LOGIN"
            onPress={onLogin}
            loading={loading}
            testID="login-submit-button"
            style={{ marginTop: spacing.sm }}
          />

          <View style={styles.footRow}>
            <Text style={styles.footText}>New shop? </Text>
            <Pressable onPress={() => router.push("/signup")} testID="login-goto-signup">
              <Text style={styles.footLink}>CREATE ACCOUNT →</Text>
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
  brand: { alignItems: "flex-start", gap: spacing.md },
  brandBox: {
    width: 64, height: 64, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.brand,
  },
  brandGlyph: { color: colors.onBrandPrimary, fontSize: 34, fontFamily: font.display, fontWeight: "900" },
  title: { fontSize: 34, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -1 },
  subtitle: { fontSize: 14, color: colors.muted, fontFamily: font.display, letterSpacing: 2, textTransform: "uppercase" },
  card: {
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.lg, backgroundColor: colors.surface,
  },
  cardTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.lg, fontFamily: font.display },
  err: {
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, marginBottom: spacing.sm, fontFamily: font.display, fontWeight: "700",
  },
  footRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: spacing.lg },
  footText: { color: colors.muted, fontFamily: font.display },
  footLink: { color: colors.brandPrimary, fontWeight: "800", fontFamily: font.display, letterSpacing: 1 },
});
