import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import { colors, font, spacing } from "@/src/theme";

// Brutalist Button — sharp corners, 2pt border
export function Button({
  label,
  onPress,
  variant = "primary",
  loading,
  disabled,
  testID,
  style,
  small,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
  small?: boolean;
}) {
  const isDisabled = !!disabled || !!loading;
  const bg =
    variant === "primary" ? colors.brandPrimary :
    variant === "danger" ? colors.error :
    variant === "secondary" ? colors.surface :
    "transparent";
  const fg =
    variant === "primary" ? colors.onBrandPrimary :
    variant === "danger" ? colors.onError :
    variant === "secondary" ? colors.onSurface :
    colors.onSurface;
  const borderColor =
    variant === "ghost" ? "transparent" :
    variant === "primary" ? colors.brand :
    colors.borderStrong;

  return (
    <Pressable
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor,
          opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1,
          paddingVertical: small ? 10 : 16,
          paddingHorizontal: small ? 14 : 18,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnLabel, { color: fg, fontSize: small ? 14 : 16 }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Input({
  label,
  hint,
  error,
  testID,
  inputRef,
  ...rest
}: TextInputProps & { label?: string; hint?: string; error?: string; testID?: string; inputRef?: React.Ref<TextInput> }) {
  return (
    <View style={{ gap: 6, marginBottom: spacing.md }}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <TextInput
        testID={testID}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          rest.multiline ? { minHeight: 90, textAlignVertical: "top" } : null,
          error ? { borderColor: colors.error } : null,
        ]}
        {...rest}
        ref={inputRef as any}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, style, testID }: { children: React.ReactNode; style?: ViewStyle; testID?: string }) {
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Empty({ title, subtitle, testID }: { title: string; subtitle?: string; testID?: string }) {
  return (
    <View testID={testID} style={styles.empty}>
      <View style={styles.emptyBox}>
        <Text style={styles.emptyGlyph}>◻</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
    minHeight: 48,
  },
  btnLabel: {
    fontFamily: font.display,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.onSurface,
    backgroundColor: colors.surface,
    borderRadius: 0,
    minHeight: 48,
    fontFamily: font.display,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.onSurfaceTertiary,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontFamily: font.display,
  },
  hint: { fontSize: 12, color: colors.muted, fontFamily: font.display },
  errorText: { fontSize: 12, color: colors.error, fontFamily: font.display, fontWeight: "700" },
  card: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  divider: { height: 2, backgroundColor: colors.divider, marginVertical: spacing.md },
  empty: {
    alignItems: "center",
    padding: spacing.xxl,
    gap: spacing.md,
  },
  emptyBox: {
    width: 72, height: 72, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  emptyGlyph: { fontSize: 32, color: colors.onSurface, fontFamily: font.display },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  emptySubtitle: { fontSize: 13, color: colors.muted, textAlign: "center", fontFamily: font.display },
});
