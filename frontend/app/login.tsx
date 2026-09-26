import { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  useWindowDimensions,
} from "react-native";
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const contentWidth = Math.min(windowWidth - spacing.lg * 2, 420);
  const isShort = windowHeight < 700;
  const logoSize = Math.max(56, Math.min(isShort ? 68 : 80, Math.round(windowWidth * 0.18)));
  const brandTopPad = isShort ? spacing.md : spacing.xxl;
  const brandGap = isShort ? spacing.lg : spacing.xl;

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
      <KeyboardFormScroll
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: brandTopPad },
        ]}
      >
        <View style={[styles.column, { width: contentWidth }]}>
          <View style={[styles.brand, { marginBottom: brandGap }]}>
            {/* Existing Lemon Mandi brand mark from the current login screen */}
            <View
              style={[styles.brandBox, { width: logoSize, height: logoSize }]}
              accessibilityLabel="Lemon Mandi logo"
            >
              <Text style={[styles.brandGlyph, { fontSize: Math.round(logoSize * 0.52) }]}>◤</Text>
            </View>
            <Text style={[styles.title, isShort && styles.titleCompact]}>LEMON MANDI</Text>
            <Text style={styles.subtitle}>Merchant Billing / Patti</Text>
          </View>

          <View style={[styles.card, isShort && styles.cardCompact]}>
            <Text style={[styles.cardTitle, isShort && styles.cardTitleCompact]}>Sign in to your shop</Text>

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
              disabled={loading}
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

          {/* Grows to pin the product footer to the bottom on tall phones */}
          <View style={styles.spacer} />

          <View style={styles.productFooter} testID="login-product-footer">
            <Text style={styles.productFooterText}>
              <Text style={styles.productBy}>Product by </Text>
              <Text style={styles.productBrand}>RateBolo</Text>
            </Text>
          </View>
        </View>
      </KeyboardFormScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: "center",
  },
  column: {
    flexGrow: 1,
    width: "100%",
    alignSelf: "center",
  },
  brand: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  brandBox: {
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.brand,
  },
  brandGlyph: {
    color: colors.onBrandPrimary,
    fontFamily: font.display,
    fontWeight: "900",
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: colors.onSurface,
    fontFamily: font.display,
    letterSpacing: -0.8,
    textAlign: "center",
  },
  titleCompact: {
    fontSize: 28,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: font.display,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    textAlign: "center",
  },
  card: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    width: "100%",
  },
  cardCompact: {
    padding: spacing.md,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.onSurface,
    marginBottom: spacing.lg,
    fontFamily: font.display,
    textAlign: "center",
  },
  cardTitleCompact: {
    fontSize: 16,
    marginBottom: spacing.md,
  },
  err: {
    color: colors.error,
    backgroundColor: "#FEE2E2",
    borderWidth: 2,
    borderColor: colors.error,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    fontFamily: font.display,
    fontWeight: "700",
  },
  footRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    marginTop: spacing.lg,
  },
  footText: { color: colors.muted, fontFamily: font.display },
  footLink: {
    color: colors.brandPrimary,
    fontWeight: "800",
    fontFamily: font.display,
    letterSpacing: 1,
  },
  spacer: { flexGrow: 1, minHeight: spacing.md },
  productFooter: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  productFooterText: {
    textAlign: "center",
  },
  productBy: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: font.display,
    fontWeight: "500",
  },
  productBrand: {
    fontSize: 13,
    color: colors.onSurface,
    fontFamily: font.display,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});
