import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, apiErrorMessage, BagInvoice } from "@/src/api";
import { Button } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";
import {
  previewBagInvoice,
  resolveBagInvoiceGst,
  resolveBagInvoiceSeller,
  shareBagInvoicePdf,
} from "@/src/utils/bag-invoice-print";

function routeParam(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] || "";
  return v || "";
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    const dd = String(d.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
  } catch {
    return String(iso).slice(0, 10);
  }
}

export default function BillingInvoiceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const purchaseId = routeParam(params.id);
  const [inv, setInv] = useState<BagInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!purchaseId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await api.get<BagInvoice>(`/billing/purchases/${purchaseId}/invoice`);
      setInv(data);
    } catch (e) {
      Alert.alert("Invoice unavailable", apiErrorMessage(e, "Could not load invoice"), [
        { text: "OK", onPress: () => router.back() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [purchaseId, router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onPdf = async () => {
    if (!inv) return;
    try {
      setBusy(true);
      await shareBagInvoicePdf(inv);
    } catch (e) {
      Alert.alert("PDF failed", apiErrorMessage(e, "Could not generate PDF"));
    } finally {
      setBusy(false);
    }
  };

  const onPreview = async () => {
    if (!inv) return;
    try {
      setBusy(true);
      await previewBagInvoice(inv);
    } catch (e) {
      Alert.alert("Preview failed", apiErrorMessage(e, "Could not open invoice preview"));
    } finally {
      setBusy(false);
    }
  };

  const to = inv?.billing_to;
  const seller = inv ? resolveBagInvoiceSeller(inv.seller) : null;
  const gst = inv ? resolveBagInvoiceGst(inv) : null;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="billing-invoice-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>BAG INVOICE</Text>
          <Text style={styles.headerSub}>{inv?.invoice_number || "Purchase invoice"}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} testID="billing-invoice-scroll">
        {loading || !inv || !seller || !gst ? (
          <Text style={styles.hint}>{loading ? "Loading invoice…" : "Invoice not found."}</Text>
        ) : (
          <View style={styles.card} testID="billing-invoice-card">
            <Text style={styles.brand} testID="invoice-seller-brand">
              {seller.brand}
            </Text>
            <Text style={styles.legal} testID="invoice-seller-legal">
              {seller.legal_name}
            </Text>
            {seller.address_lines.map((line, i) => (
              <Text key={`seller-addr-${i}`} style={styles.meta} testID={`invoice-seller-addr-${i}`}>
                {line}
              </Text>
            ))}
            <Text style={styles.meta} testID="invoice-seller-gstin">
              GSTIN: {seller.gstin}
            </Text>
            <Text style={styles.kind}>TAX INVOICE — BAG BALANCE</Text>

            <View style={styles.hr} />

            <Text style={styles.cardLabel}>BILLING TO</Text>
            <Text style={styles.shop} testID="invoice-billing-to">
              {(to?.shop_name || "—").toUpperCase()}
            </Text>
            {to?.owner_name ? <Text style={styles.meta}>Owner: {to.owner_name}</Text> : null}
            {to?.username ? <Text style={styles.meta}>@{to.username}</Text> : null}
            {to?.address ? <Text style={styles.meta}>{to.address}</Text> : null}
            {to?.mobile || to?.email ? (
              <Text style={styles.meta}>{[to.mobile, to.email].filter(Boolean).join(" · ")}</Text>
            ) : null}
            {to?.gst_number ? <Text style={styles.meta}>GSTIN: {to.gst_number}</Text> : null}

            <View style={styles.hr} />

            <Row label="Invoice No" value={inv.invoice_number} mono testID="invoice-number" />
            <Row label="Invoice Date" value={fmtDate(inv.invoice_date)} testID="invoice-date" />
            <Row label="Service HSN" value={inv.service_hsn_code || "—"} mono testID="invoice-hsn" />
            <Row label="Bags" value={String(inv.bags.toLocaleString())} mono testID="invoice-bags" />
            <Row label="Price / Bag" value={money(inv.price_per_bag)} mono testID="invoice-price" />
            <Row
              label="Bags × Price"
              value={`${inv.bags.toLocaleString()} × ${money(inv.price_per_bag)} = ${money(inv.base_amount)}`}
              mono
              testID="invoice-calc"
            />
            <Row label="Taxable Amount" value={money(inv.base_amount)} mono testID="invoice-taxable" />
            {gst.supply === "INTER" ? (
              <Row label={`IGST (${gst.igstPct}%)`} value={money(gst.igstAmt)} mono testID="invoice-igst" />
            ) : (
              <>
                <Row label={`CGST (${gst.cgstPct}%)`} value={money(gst.cgstAmt)} mono testID="invoice-cgst" />
                <Row label={`SGST (${gst.sgstPct}%)`} value={money(gst.sgstAmt)} mono testID="invoice-sgst" />
              </>
            )}
            <View style={styles.totalBox} testID="invoice-total">
              <Text style={styles.totalLabel}>TOTAL AMOUNT</Text>
              <Text style={styles.totalValue}>{money(inv.total_amount)}</Text>
            </View>

            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              <Button label={busy ? "WORKING…" : "VIEW / PRINT"} onPress={onPreview} disabled={busy} testID="invoice-preview-btn" />
              <Button
                label={busy ? "WORKING…" : "DOWNLOAD PDF"}
                onPress={onPdf}
                disabled={busy}
                testID="invoice-pdf-btn"
              />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  mono,
  testID,
}: {
  label: string;
  value: string;
  mono?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 18, fontWeight: "900", fontFamily: font.display, color: colors.onSurface },
  headerSub: { fontSize: 12, color: colors.muted, fontFamily: font.display },
  card: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    gap: spacing.sm,
  },
  brand: { fontSize: 22, fontWeight: "900", fontFamily: font.display, color: colors.onSurface, letterSpacing: 0.5 },
  legal: { fontSize: 13, fontWeight: "700", fontFamily: font.display, color: colors.onSurface, marginTop: 2 },
  kind: {
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    color: colors.muted,
    fontFamily: font.display,
    marginTop: spacing.sm,
  },
  cardLabel: {
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "800",
    color: colors.muted,
    fontFamily: font.display,
  },
  shop: { fontSize: 20, fontWeight: "900", fontFamily: font.display, color: colors.onSurface },
  meta: { fontSize: 13, color: colors.muted, fontFamily: font.display },
  hint: { fontSize: 14, color: colors.muted, fontFamily: font.display },
  hr: { borderTopWidth: 2, borderTopColor: colors.borderStrong, marginVertical: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, paddingVertical: 4 },
  rowLabel: { fontSize: 12, fontWeight: "800", color: colors.muted, fontFamily: font.display, flex: 1 },
  rowValue: { fontSize: 13, fontWeight: "700", color: colors.onSurface, fontFamily: font.display, flex: 1.4, textAlign: "right" },
  mono: { fontFamily: font.mono },
  totalBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceInverse,
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: { color: colors.onSurfaceInverse, fontWeight: "900", letterSpacing: 1.2, fontFamily: font.display },
  totalValue: { color: colors.onSurfaceInverse, fontWeight: "900", fontSize: 20, fontFamily: font.mono },
});
