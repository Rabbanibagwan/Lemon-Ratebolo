import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { colors, font, spacing } from "@/src/theme";

export default function ActionDiary() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="action-diary-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>CREATE ACTION DIARY</Text>
          <Text style={styles.sub}>Choose how to create your Farmer Pattis</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Pressable
          testID="option-scan-diary"
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push("/ocr/capture")}
        >
          <View style={[styles.iconBox, { backgroundColor: colors.brandSecondary }]}>
            <Ionicons name="camera" size={30} color={colors.onBrandSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>SCAN ACTION DIARY (OCR)</Text>
            <Text style={styles.cardDesc}>
              Capture a photo or pick from gallery. Extracts lots automatically.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.muted} />
        </Pressable>

        <Pressable
          testID="option-manual-entry"
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push("/add-lot")}
        >
          <View style={[styles.iconBox, { backgroundColor: "#FEF3C7" }]}>
            <Ionicons name="create-outline" size={30} color="#78350F" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>MANUAL ENTRY (+ ADD LOT)</Text>
            <Text style={styles.cardDesc}>
              Type each lot by hand. Best for a single lot or quick edits.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.muted} />
        </Pressable>

        <View style={styles.hintBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
          <Text style={styles.hint}>
            Both methods create Farmer Pattis with the strict 1-Patti-per-Lot rule.
          </Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [styles.auctionBtn, pressed && { opacity: 0.9 }]}
        onPress={() => router.push("/(tabs)/auction")}
        testID="open-auction-book"
      >
        <Ionicons name="book-outline" size={16} color={colors.onSurface} />
        <Text style={styles.auctionBtnText}>OPEN AUCTION BOOK</Text>
      </Pressable>
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
  sub: { fontSize: 11, color: colors.muted, fontFamily: font.display, letterSpacing: 0.5, fontWeight: "700", marginTop: 2 },
  body: { flex: 1, padding: spacing.lg, gap: spacing.md },

  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.lg,
    backgroundColor: colors.surface, minHeight: 90,
  },
  cardPressed: { backgroundColor: colors.surfaceSecondary },
  iconBox: {
    width: 60, height: 60, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: {
    fontSize: 14, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 0.5,
  },
  cardDesc: {
    fontSize: 12, color: colors.muted, fontFamily: font.display, marginTop: 4, lineHeight: 16,
  },

  hintBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginTop: spacing.md, padding: spacing.md,
    borderWidth: 2, borderColor: colors.divider,
  },
  hint: { flex: 1, fontSize: 12, color: colors.muted, fontFamily: font.display, lineHeight: 16 },

  auctionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginHorizontal: spacing.lg, marginBottom: spacing.lg,
    borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: 14,
  },
  auctionBtnText: {
    fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 12, color: colors.onSurface,
  },
});
