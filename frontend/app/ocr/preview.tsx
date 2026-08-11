import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, FlatList, Image, Modal, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, AuctionDay, Farmer, Lot, Patti, ShopProfile, Vendor } from "@/src/api";
import { getOcrSession, clearOcrSession } from "@/src/ocr-session";
import { Input } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";
import { thermalPrintAndMark } from "@/src/utils/patti-print";
import { clampPaperMm } from "@/src/utils/thermal-print";
import { useWorkingDate } from "@/src/context/WorkingDateContext";

type VendorDraft = {
  key: string;
  vendor_name: string;
  vendor_id?: string | null;
  bags: string;
  rate_per_bag: string;
};

type LotDraft = {
  key: string;
  lot_serial_no: string;
  total_bags: string;
  farmer_name: string;
  farmer_id?: string | null;
  bhada_per_bag: string; // review UI: Bhada / Bag (editable)
  vendors: VendorDraft[];
  saving?: boolean;
  saved?: boolean;
  error?: string | null;
};

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function splitLegacyLot(s?: string | null): { serial: string; total: string } {
  if (!s) return { serial: "", total: "" };
  const m = String(s).trim().match(/^(\d+)\s*[/\\-]\s*(\d+)$/);
  if (m) return { serial: m[1], total: m[2] };
  const m2 = String(s).trim().match(/^(\d+)/);
  return { serial: m2 ? m2[1] : "", total: "" };
}

function norm(s: string): string { return (s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j - 1], dp[j]) + 1;
      prev = tmp;
    }
  }
  return dp[b.length];
}
function fuzzyMatchId(input: string, list: { id: string; name: string }[]): string | null {
  const q = norm(input);
  if (!q || q.length < 2 || !list.length) return null;
  let best: { id: string; score: number } | null = null;
  for (const item of list) {
    const t = norm(item.name);
    if (!t) continue;
    if (t === q) return item.id;
    if (t.startsWith(q) || q.startsWith(t) || t.includes(q) || q.includes(t)) return item.id;
    const d = lev(q, t);
    const rel = 1 - d / Math.max(q.length, t.length);
    if (rel >= 0.72 && (!best || rel > best.score)) best = { id: item.id, score: rel };
  }
  return best ? best.id : null;
}

function rowsToLots(raw: any[]): LotDraft[] {
  const map = new Map<string, LotDraft>();
  for (const r of raw) {
    let serial = r.lot_serial_no != null ? String(r.lot_serial_no) : "";
    let total = r.total_bags != null ? String(r.total_bags) : "";
    if (!serial || !total) {
      const legacy = splitLegacyLot(r.lot_no);
      if (!serial) serial = legacy.serial;
      if (!total) total = legacy.total;
    }
    const farmer = (r.farmer_name || "").trim();
    const gkey = `${serial}#${farmer.toLowerCase()}`;
    let lot = map.get(gkey);
    if (!lot) {
      // Prefer explicit per-bag; else derive from total.
      let bhadaPerBag = "";
      if (r.bhada_per_bag != null) bhadaPerBag = String(r.bhada_per_bag);
      else if (r.bhada_total != null && Number(total) > 0) {
        bhadaPerBag = String(Math.round((Number(r.bhada_total) / Number(total)) * 1000) / 1000);
      }
      lot = {
        key: newKey(),
        lot_serial_no: serial,
        total_bags: total,
        farmer_name: farmer,
        farmer_id: null,
        bhada_per_bag: bhadaPerBag,
        vendors: [],
      };
      map.set(gkey, lot);
    } else {
      if (!lot.total_bags && total) lot.total_bags = total;
      if (!lot.bhada_per_bag) {
        if (r.bhada_per_bag != null) lot.bhada_per_bag = String(r.bhada_per_bag);
        else if (r.bhada_total != null && Number(lot.total_bags) > 0) {
          lot.bhada_per_bag = String(Math.round((Number(r.bhada_total) / Number(lot.total_bags)) * 1000) / 1000);
        }
      }
    }
    if (r.vendor_name || r.bags != null) {
      lot.vendors.push({
        key: newKey(),
        vendor_name: r.vendor_name || "",
        vendor_id: null,
        bags: r.bags != null ? String(r.bags) : "",
        rate_per_bag: r.rate_per_bag != null ? String(r.rate_per_bag) : "",
      });
    }
  }
  // Ensure every lot has at least one vendor slot (but only one — never auto-duplicate)
  for (const lot of map.values()) {
    if (!lot.vendors.length) {
      lot.vendors.push({ key: newKey(), vendor_name: "", vendor_id: null, bags: "", rate_per_bag: "" });
    }
  }
  return Array.from(map.values());
}

function auctionStatus(lot: LotDraft): { ok: boolean; kind: "ok" | "pending" | "over" | "empty"; message: string; sold: number; total: number } {
  const total = Number(lot.total_bags) || 0;
  const sold = lot.vendors.reduce((n, v) => n + (Number(v.bags) || 0), 0);
  if (!total) return { ok: false, kind: "empty", message: "Enter total bags for this lot.", sold, total };
  if (sold === total) return { ok: true, kind: "ok", message: "✓ Auction Complete", sold, total };
  if (sold < total) {
    return {
      ok: false,
      kind: "pending",
      message: `Auction incomplete – ${total - sold} bag${total - sold === 1 ? " is" : "s are"} still pending for Lot ${lot.lot_serial_no || "?"}.`,
      sold,
      total,
    };
  }
  return {
    ok: false,
    kind: "over",
    message: `Invalid quantity – sold quantity exceeds the total bags in Lot ${lot.lot_serial_no || "?"}.`,
    sold,
    total,
  };
}

export default function OcrPreview() {
  const router = useRouter();
  const { workingDateISO } = useWorkingDate();

  const [lots, setLots] = useState<LotDraft[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [day, setDay] = useState<AuctionDay | null>(null);
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ ok: number; fail: number } | null>(null);

  useEffect(() => {
    const session = getOcrSession();
    setLots(rowsToLots(session.rows || []));
    setWarning(session.warning || null);
    setPhotoUri(session.imageUri || null);
    (async () => {
      try {
        const [d, f, v] = await Promise.all([
          api.get<AuctionDay>(`/auction-days/today?date=${workingDateISO}`),
          api.get<Farmer[]>("/farmers"),
          api.get<Vendor[]>("/vendors"),
        ]);
        setDay(d); setFarmers(f); setVendors(v);
        setLots((xs) => xs.map((lot) => ({
          ...lot,
          farmer_id: lot.farmer_id || fuzzyMatchId(lot.farmer_name, f.map((x) => ({ id: x.id, name: x.name }))),
          vendors: lot.vendors.map((vd) => ({
            ...vd,
            vendor_id: vd.vendor_id || fuzzyMatchId(vd.vendor_name, v.map((x) => ({ id: x.id, name: x.name }))),
          })),
        })));
      } catch { /* silent */ }
    })();
  }, [workingDateISO]);

  const [pickerFor, setPickerFor] = useState<
    null | { lotKey: string; kind: "farmer" } | { lotKey: string; vendorKey: string; kind: "vendor" }
  >(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerList = useMemo(() => {
    if (!pickerFor) return [];
    const list = pickerFor.kind === "farmer" ? farmers : vendors;
    const q = pickerQuery.trim().toLowerCase();
    return q ? list.filter((x) => x.name.toLowerCase().includes(q)) : list.slice(0, 200);
  }, [pickerFor, pickerQuery, farmers, vendors]);

  const updateLot = (lotKey: string, patch: Partial<LotDraft>) =>
    setLots((xs) => xs.map((l) => (l.key === lotKey ? { ...l, ...patch } : l)));

  const updateVendor = (lotKey: string, vendorKey: string, patch: Partial<VendorDraft>) =>
    setLots((xs) => xs.map((l) => {
      if (l.key !== lotKey) return l;
      return { ...l, vendors: l.vendors.map((v) => (v.key === vendorKey ? { ...v, ...patch } : v)) };
    }));

  const addVendor = (lotKey: string) => {
    setLots((xs) => xs.map((l) => {
      if (l.key !== lotKey) return l;
      return {
        ...l,
        vendors: [...l.vendors, { key: newKey(), vendor_name: "", vendor_id: null, bags: "", rate_per_bag: "" }],
      };
    }));
  };

  const removeVendor = (lotKey: string, vendorKey: string) => {
    setLots((xs) => xs.map((l) => {
      if (l.key !== lotKey) return l;
      if (l.vendors.length <= 1) return l;
      return { ...l, vendors: l.vendors.filter((v) => v.key !== vendorKey) };
    }));
  };

  const removeLot = (lotKey: string) => setLots((xs) => xs.filter((l) => l.key !== lotKey));

  const addEmptyLot = () => {
    setLots((xs) => [...xs, {
      key: newKey(),
      lot_serial_no: "",
      total_bags: "",
      farmer_name: "",
      farmer_id: null,
      bhada_per_bag: "",
      vendors: [{ key: newKey(), vendor_name: "", vendor_id: null, bags: "", rate_per_bag: "" }],
    }]);
  };

  const pickMaster = (id: string, name: string) => {
    if (!pickerFor) return;
    if (pickerFor.kind === "farmer") {
      updateLot(pickerFor.lotKey, { farmer_id: id, farmer_name: name });
    } else {
      updateVendor(pickerFor.lotKey, pickerFor.vendorKey, { vendor_id: id, vendor_name: name });
    }
    setPickerFor(null); setPickerQuery("");
  };

  const findOrCreateFarmer = useCallback(async (name: string): Promise<string | null> => {
    if (!name.trim()) return null;
    const found = farmers.find((f) => f.name.toLowerCase() === name.trim().toLowerCase());
    if (found) return found.id;
    const created = await api.post<Farmer>("/farmers", { name: name.trim() });
    setFarmers((xs) => [...xs, created]);
    return created.id;
  }, [farmers]);

  const findOrCreateVendor = useCallback(async (name: string): Promise<string | null> => {
    if (!name.trim()) return null;
    const found = vendors.find((v) => v.name.toLowerCase() === name.trim().toLowerCase());
    if (found) return found.id;
    // Vendor Details is mandatory in API — use a clear OCR placeholder.
    const created = await api.post<Vendor>("/vendors", {
      name: name.trim(),
      details: `OCR · ${name.trim()}`,
    });
    setVendors((xs) => [...xs, created]);
    return created.id;
  }, [vendors]);

  const saveAll = async (mode: "save" | "print" = "save") => {
    if (!day) { setError("Working-date auction day not loaded"); return; }
    setError(null); setSummary(null);

    // Validate every lot before creating any Pattis (OCR must never save unverified data).
    const blockers: string[] = [];
    for (const lot of lots) {
      if (!lot.lot_serial_no.trim() || !lot.total_bags.trim() || !lot.farmer_name.trim()) {
        blockers.push(`Lot ${lot.lot_serial_no || "?"} — missing Lot No. / Total Bags / Farmer.`);
        continue;
      }
      const filled = lot.vendors.filter((v) => v.vendor_name.trim() && Number(v.bags) > 0 && Number(v.rate_per_bag) > 0);
      if (!filled.length) {
        blockers.push(`Lot ${lot.lot_serial_no} — add at least one vendor sale.`);
        continue;
      }
      const st = auctionStatus({ ...lot, vendors: filled });
      if (!st.ok) blockers.push(st.message);
    }
    if (blockers.length) {
      setError(blockers[0]);
      Alert.alert("Fix before save", blockers.slice(0, 4).join("\n"));
      return;
    }

    setSaving(true);
    let ok = 0, fail = 0;
    const createdPattiIds: string[] = [];

    for (const lot of lots) {
      updateLot(lot.key, { saving: true, error: null });
      try {
        let fid = lot.farmer_id || fuzzyMatchId(lot.farmer_name, farmers.map((x) => ({ id: x.id, name: x.name })));
        if (!fid) fid = await findOrCreateFarmer(lot.farmer_name);
        if (!fid) throw new Error("Failed to find/create farmer");

        const sales: { vendor_id: string; bags: number; rate_per_bag: number }[] = [];
        for (const v of lot.vendors) {
          if (!v.vendor_name.trim() || !(Number(v.bags) > 0)) continue;
          let vid = v.vendor_id || fuzzyMatchId(v.vendor_name, vendors.map((x) => ({ id: x.id, name: x.name })));
          if (!vid) vid = await findOrCreateVendor(v.vendor_name);
          if (!vid) throw new Error("Failed to find/create vendor");
          sales.push({ vendor_id: vid, bags: Number(v.bags), rate_per_bag: Number(v.rate_per_bag) });
        }

        const payload: any = {
          auction_day_id: day.id,
          lot_serial_no: Number(lot.lot_serial_no),
          total_bags: Number(lot.total_bags),
          farmer_id: fid,
          sales,
        };
        if (lot.bhada_per_bag.trim() !== "") {
          payload.bhada_per_bag = Number(lot.bhada_per_bag);
        }
        const savedLot = await api.post<Lot>("/lots", payload);
        if (savedLot?.patti_id) createdPattiIds.push(savedLot.patti_id);
        updateLot(lot.key, { saving: false, saved: true, error: null });
        ok += 1;
      } catch (e: any) {
        let msg = e?.detail || e?.message || "Failed";
        if (typeof msg === "object") {
          msg = msg?.message || (msg?.code === "duplicate_lot" ? "Duplicate lot" : "Failed");
        }
        updateLot(lot.key, { saving: false, saved: false, error: String(msg) });
        fail += 1;
      }
    }

    setSaving(false);
    setSummary({ ok, fail });
    if (fail === 0 && ok > 0) {
      if (mode === "print" && createdPattiIds.length > 0) {
        try {
          const [profile, settingsDoc] = await Promise.all([
            api.get<ShopProfile>("/shop/profile").catch(() => null),
            api.get<any>("/settings").catch(() => null),
          ]);
          const paperMm = clampPaperMm(settingsDoc?.thermal_paper_width_mm || 80);
          for (const pid of createdPattiIds) {
            try {
              const patti = await api.get<Patti>(`/pattis/${pid}`);
              await thermalPrintAndMark(patti, profile || { shop_name: "" } as any, paperMm);
            } catch (e) {
              console.warn("print patti failed", pid, e);
            }
          }
        } catch (e) {
          console.warn("print pipeline failed", e);
        }
      }
      Alert.alert(
        "Saved",
        `${ok} lot${ok === 1 ? "" : "s"} saved — one Farmer Patti per lot. Vendor purchase data is ready for Vendor Bills.`,
        [{ text: "OK", onPress: () => { clearOcrSession(); router.replace("/action-diary"); } }],
      );
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="ocr-preview-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>REVIEW EXTRACTION</Text>
          <Text style={styles.headerSub}>{lots.length} lot{lots.length === 1 ? "" : "s"} · edit before saving</Text>
        </View>
      </View>

      {warning ? (
        <View style={styles.warnBox}>
          <Ionicons name="warning-outline" size={14} color="#78350F" />
          <Text style={styles.warnText}>{warning}</Text>
        </View>
      ) : null}

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={120}
      >
        {photoUri ? (
          <View style={styles.photoRef}>
            <Text style={styles.photoRefLabel}>PHOTO REFERENCE</Text>
            <Image source={{ uri: photoUri }} style={styles.photoRefImg} resizeMode="contain" />
          </View>
        ) : null}
        {lots.map((lot, li) => {
          const st = auctionStatus(lot);
          return (
            <View key={lot.key} style={[styles.lotCard, lot.saved && styles.lotSaved, !!lot.error && styles.lotErr]} testID={`ocr-lot-card-${li}`}>
              <View style={styles.lotHead}>
                <Text style={styles.lotHeadText}>LOT {lot.lot_serial_no || li + 1}</Text>
                {lot.saving ? <Text style={styles.statusPending}>SAVING…</Text> : null}
                {lot.saved ? <Text style={styles.statusOk}>✓ SAVED</Text> : null}
                {!lot.saved && !lot.saving ? (
                  <Pressable onPress={() => removeLot(lot.key)} hitSlop={10} testID={`ocr-lot-remove-${li}`}>
                    <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>

              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="LOT NO."
                    value={lot.lot_serial_no}
                    onChangeText={(v) => updateLot(lot.key, { lot_serial_no: v.replace(/[^0-9]/g, "") })}
                    keyboardType="number-pad"
                    testID={`ocr-lot-${li}`}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="TOTAL BAGS"
                    value={lot.total_bags}
                    onChangeText={(v) => updateLot(lot.key, { total_bags: v.replace(/[^0-9]/g, "") })}
                    keyboardType="number-pad"
                    testID={`ocr-total-bags-${li}`}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="BHADA / BAG ₹"
                    value={lot.bhada_per_bag}
                    onChangeText={(v) => updateLot(lot.key, { bhada_per_bag: v.replace(/[^0-9.]/g, "") })}
                    keyboardType="decimal-pad"
                    testID={`ocr-bhada-${li}`}
                  />
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}>
                  <Input
                    label={lot.farmer_id ? "FARMER ✓ linked" : "FARMER"}
                    value={lot.farmer_name}
                    onChangeText={(v) => updateLot(lot.key, { farmer_name: v, farmer_id: null })}
                    testID={`ocr-farmer-${li}`}
                  />
                </View>
                <Pressable
                  style={[styles.pickBtn, lot.farmer_id && styles.pickBtnOn]}
                  onPress={() => {
                    setPickerQuery(lot.farmer_name);
                    setPickerFor({ lotKey: lot.key, kind: "farmer" });
                  }}
                  testID={`ocr-pick-farmer-${li}`}
                >
                  <Ionicons name="link" size={14} color={lot.farmer_id ? colors.onBrandPrimary : colors.onSurface} />
                </Pressable>
              </View>

              <Text style={styles.section}>VENDOR SALES</Text>
              {lot.vendors.map((v, vi) => (
                <View key={v.key} style={styles.vendorCard} testID={`ocr-vendor-card-${li}-${vi}`}>
                  <View style={styles.vendorHead}>
                    <Text style={styles.vendorHeadText}>VENDOR {vi + 1}</Text>
                    {lot.vendors.length > 1 ? (
                      <Pressable onPress={() => removeVendor(lot.key, v.key)} hitSlop={10} testID={`ocr-vendor-remove-${li}-${vi}`}>
                        <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" }}>
                    <View style={{ flex: 1 }}>
                      <Input
                        label={v.vendor_id ? "Vendor ✓ linked" : "Vendor"}
                        value={v.vendor_name}
                        onChangeText={(t) => updateVendor(lot.key, v.key, { vendor_name: t, vendor_id: null })}
                        testID={`ocr-vendor-${li}-${vi}`}
                      />
                    </View>
                    <Pressable
                      style={[styles.pickBtn, v.vendor_id && styles.pickBtnOn]}
                      onPress={() => {
                        setPickerQuery(v.vendor_name);
                        setPickerFor({ lotKey: lot.key, vendorKey: v.key, kind: "vendor" });
                      }}
                      testID={`ocr-pick-vendor-${li}-${vi}`}
                    >
                      <Ionicons name="link" size={14} color={v.vendor_id ? colors.onBrandPrimary : colors.onSurface} />
                    </Pressable>
                  </View>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Input
                        label="Bags"
                        value={v.bags}
                        onChangeText={(t) => updateVendor(lot.key, v.key, { bags: t.replace(/[^0-9]/g, "") })}
                        keyboardType="number-pad"
                        testID={`ocr-bags-${li}-${vi}`}
                      />
                    </View>
                    <View style={{ flex: 1.3 }}>
                      <Input
                        label="Rate / Bag ₹"
                        value={v.rate_per_bag}
                        onChangeText={(t) => updateVendor(lot.key, v.key, { rate_per_bag: t.replace(/[^0-9.]/g, "") })}
                        keyboardType="decimal-pad"
                        testID={`ocr-rate-${li}-${vi}`}
                      />
                    </View>
                  </View>
                </View>
              ))}

              <Pressable style={styles.addVendor} onPress={() => addVendor(lot.key)} testID={`ocr-add-vendor-${li}`}>
                <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.addVendorText}>+ ADD ANOTHER VENDOR</Text>
              </Pressable>

              <View style={[
                styles.statusBox,
                st.kind === "ok" && styles.statusOkBox,
                st.kind === "pending" && styles.statusWarnBox,
                st.kind === "over" && styles.statusErrBox,
              ]}>
                <Text style={styles.statusMsg}>{st.message}</Text>
                <Text style={styles.statusMeta}>{st.sold} / {st.total} bags</Text>
              </View>
              {lot.error ? <Text style={styles.lotError}>{lot.error}</Text> : null}
            </View>
          );
        })}

        <Pressable style={styles.addLot} onPress={addEmptyLot} testID="ocr-add-lot">
          <Ionicons name="add-circle-outline" size={20} color={colors.onSurface} />
          <Text style={styles.addLotText}>ADD LOT MANUALLY</Text>
        </Pressable>

        {lots.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No lots to review. Go back and scan again, or paste diary text.</Text>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      <KeyboardStickyView>
        <View style={styles.footer}>
          {summary ? (
            <Text style={styles.sumLine}>{summary.ok} saved · {summary.fail} failed · edit failed lots and retry.</Text>
          ) : null}
          {error ? <Text style={styles.err}>{error}</Text> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable
              style={({ pressed }) => [ocrStyles.actBtn, ocrStyles.actSave, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}
              onPress={() => saveAll("save")}
              disabled={saving}
              testID="ocr-save-all"
            >
              <Ionicons name="save-outline" size={16} color={colors.onSurface} />
              <Text style={[ocrStyles.actBtnText, { color: colors.onSurface }]}>{saving ? "SAVING…" : "SAVE"}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [ocrStyles.actBtn, ocrStyles.actPrint, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}
              onPress={() => saveAll("print")}
              disabled={saving}
              testID="ocr-save-and-print"
            >
              <Ionicons name="print-outline" size={16} color={colors.onSurfaceInverse} />
              <Text style={[ocrStyles.actBtnText, { color: colors.onSurfaceInverse }]}>SAVE & PRINT</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>

      <Modal visible={!!pickerFor} transparent animationType="slide" onRequestClose={() => setPickerFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                LINK {pickerFor?.kind === "farmer" ? "FARMER" : "VENDOR"}
              </Text>
              <Pressable onPress={() => setPickerFor(null)} hitSlop={10} testID="ocr-picker-close">
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <TextInput
              style={styles.modalSearch}
              value={pickerQuery}
              onChangeText={setPickerQuery}
              placeholder="Search…"
              placeholderTextColor={colors.muted}
              autoFocus
              testID="ocr-picker-search"
            />
            <FlatList
              data={pickerList}
              keyExtractor={(x) => x.id}
              contentContainerStyle={{ paddingBottom: 40 }}
              renderItem={({ item }) => (
                <Pressable style={styles.pickerItem} onPress={() => pickMaster(item.id, item.name)} testID={`ocr-picker-item-${item.id}`}>
                  <Text style={styles.pickerItemText}>{item.name}</Text>
                </Pressable>
              )}
              ListEmptyComponent={() => (
                <View style={styles.pickerEmpty}>
                  <Text style={styles.pickerEmptyText}>No matches. Name will be saved as a new master record.</Text>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const ocrStyles = StyleSheet.create({
  actBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 2, paddingVertical: 14,
  },
  actSave: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  actPrint: { borderColor: colors.surfaceInverse, backgroundColor: colors.surfaceInverse },
  actBtnText: { fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 12 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: colors.muted, letterSpacing: 1, fontWeight: "700" },
  warnBox: {
    flexDirection: "row", alignItems: "center", gap: 8, margin: spacing.md,
    backgroundColor: "#FEF3C7", borderWidth: 2, borderColor: "#F59E0B", padding: spacing.sm,
  },
  warnText: { flex: 1, color: "#78350F", fontFamily: font.display, fontSize: 12, fontWeight: "700" },
  photoRef: {
    borderWidth: 2, borderColor: colors.borderStrong, marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary, overflow: "hidden",
  },
  photoRefLabel: {
    fontSize: 10, letterSpacing: 1.5, fontFamily: font.display, fontWeight: "900",
    color: colors.muted, paddingHorizontal: spacing.sm, paddingTop: spacing.sm,
  },
  photoRefImg: { width: "100%", height: 160, backgroundColor: "#111" },

  lotCard: {
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.md, backgroundColor: colors.surface,
  },
  lotSaved: { borderColor: "#059669", backgroundColor: "#ECFDF5" },
  lotErr: { borderColor: colors.error },
  lotHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  lotHeadText: { flex: 1, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 13, color: colors.onSurface },
  statusPending: { fontSize: 11, color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  statusOk: { fontSize: 11, color: "#065F46", fontFamily: font.display, fontWeight: "800" },

  section: {
    marginTop: spacing.sm, marginBottom: 6,
    fontSize: 10, letterSpacing: 1.5, fontFamily: font.display, fontWeight: "900", color: colors.muted,
  },
  vendorCard: {
    borderWidth: 2, borderColor: colors.divider, padding: spacing.sm, marginBottom: spacing.sm, backgroundColor: colors.surfaceSecondary,
  },
  vendorHead: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  vendorHeadText: { flex: 1, fontSize: 11, letterSpacing: 1, fontFamily: font.display, fontWeight: "800", color: colors.onSurface },

  pickBtn: {
    width: 44, height: 48, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  pickBtnOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brand },

  addVendor: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, marginBottom: spacing.sm,
  },
  addVendorText: { fontFamily: font.display, fontWeight: "800", letterSpacing: 1, fontSize: 12, color: colors.brandPrimary },

  statusBox: { borderWidth: 2, padding: spacing.sm, marginTop: 4 },
  statusOkBox: { borderColor: "#059669", backgroundColor: "#ECFDF5" },
  statusWarnBox: { borderColor: "#D97706", backgroundColor: "#FFFBEB" },
  statusErrBox: { borderColor: colors.error, backgroundColor: "#FEE2E2" },
  statusMsg: { fontFamily: font.display, fontWeight: "700", fontSize: 12, color: colors.onSurface },
  statusMeta: { fontFamily: font.mono, fontSize: 11, color: colors.muted, marginTop: 2 },
  lotError: { marginTop: 6, color: colors.error, fontFamily: font.display, fontWeight: "700", fontSize: 12 },

  addLot: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 2, borderColor: colors.borderStrong, borderStyle: "dashed", paddingVertical: 14, marginBottom: spacing.lg,
  },
  addLotText: { fontFamily: font.display, fontWeight: "800", letterSpacing: 1, fontSize: 12, color: colors.onSurface },
  emptyBox: { padding: spacing.xl, alignItems: "center" },
  emptyText: { color: colors.muted, fontFamily: font.display, textAlign: "center" },

  footer: {
    borderTopWidth: 2, borderTopColor: colors.borderStrong,
    padding: spacing.lg, backgroundColor: colors.surface, gap: spacing.sm,
  },
  sumLine: { fontFamily: font.display, fontSize: 12, color: colors.muted, textAlign: "center" },
  err: {
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, fontFamily: font.display, fontWeight: "700",
  },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.surface, maxHeight: "70%", borderTopWidth: 2, borderColor: colors.borderStrong },
  modalHeader: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  modalTitle: { flex: 1, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 14 },
  modalSearch: {
    margin: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, height: 44, paddingHorizontal: 12,
    fontFamily: font.display, color: colors.onSurface,
  },
  pickerItem: { paddingHorizontal: spacing.lg, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  pickerItemText: { fontFamily: font.display, fontSize: 15, fontWeight: "700", color: colors.onSurface },
  pickerEmpty: { padding: spacing.xl },
  pickerEmptyText: { color: colors.muted, fontFamily: font.display, textAlign: "center" },
});
