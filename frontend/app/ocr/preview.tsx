import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Image, Pressable,
  StyleSheet, Text, View,
} from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, apiErrorMessage, AuctionDay, Farmer, Lot, Patti, ShopProfile, Vendor } from "@/src/api";
import { getOcrSession, clearOcrSession } from "@/src/ocr-session";
import { Input } from "@/src/components/ui";
import { PartyPicker, findExactParty } from "@/src/components/PartyPicker";
import { colors, font, spacing } from "@/src/theme";
import { thermalPrintAndMark, canUserPrintPatti } from "@/src/utils/patti-print";
import { clampPaperMm } from "@/src/utils/thermal-print";
import { useWorkingDate } from "@/src/context/WorkingDateContext";
import { useAuth } from "@/src/context/AuthContext";
import { handleBagBillingError, isInsufficientBagBalance } from "@/src/utils/bag-billing";

type VendorDraft = {
  key: string;
  vendor_name: string;
  vendor_id?: string | null;
  bags: string;
  rate_per_bag: string;
};

type LotWorkflowStatus =
  | "ready"
  | "saving"
  | "saved"
  | "printing"
  | "printed"
  | "duplicate"
  | "error";

type LotDraft = {
  key: string;
  lot_serial_no: string;
  total_bags: string;
  farmer_name: string;
  farmer_id?: string | null;
  bhada_total: string; // lot-level circled bhada (NOT per bag)
  vendors: VendorDraft[];
  saving?: boolean;
  saved?: boolean;
  printed?: boolean;
  patti_id?: string | null;
  status?: LotWorkflowStatus;
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
      // Circled diary amount is lot bhada once — prefer bhada_total; never divide/multiply by bags.
      let bhadaTotal = "";
      if (r.bhada_total != null) bhadaTotal = String(r.bhada_total);
      else if (r.bhada_per_bag != null) bhadaTotal = String(r.bhada_per_bag);
      lot = {
        key: newKey(),
        lot_serial_no: serial,
        total_bags: total,
        farmer_name: farmer,
        farmer_id: null,
        bhada_total: bhadaTotal,
        vendors: [],
      };
      map.set(gkey, lot);
    } else {
      if (!lot.total_bags && total) lot.total_bags = total;
      if (!lot.bhada_total) {
        if (r.bhada_total != null) lot.bhada_total = String(r.bhada_total);
        else if (r.bhada_per_bag != null) lot.bhada_total = String(r.bhada_per_bag);
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
  const { session } = useAuth();
  const scrollRef = useRef<any>(null);
  const scrollYRef = useRef(0);

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

  const restoreScrollAfterLink = () => {
    const y = scrollYRef.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          scrollRef.current?.scrollTo?.({ y, animated: false });
        } catch {
          /* ignore */
        }
      });
    });
  };

  const updateLot = (lotKey: string, patch: Partial<LotDraft>) =>
    setLots((xs) =>
      xs.map((l) => {
        if (l.key !== lotKey) return l;
        const next: LotDraft = { ...l, ...patch };
        if (
          patch.lot_serial_no !== undefined ||
          patch.total_bags !== undefined ||
          patch.farmer_name !== undefined ||
          patch.vendors !== undefined ||
          patch.bhada_total !== undefined
        ) {
          if (l.status === "duplicate" || l.status === "error") {
            next.status = "ready";
            if (patch.error === undefined) next.error = null;
          }
        }
        return next;
      }),
    );

  const updateVendor = (lotKey: string, vendorKey: string, patch: Partial<VendorDraft>) =>
    setLots((xs) => xs.map((l) => {
      if (l.key !== lotKey) return l;
      const next: LotDraft = {
        ...l,
        vendors: l.vendors.map((v) => (v.key === vendorKey ? { ...v, ...patch } : v)),
      };
      if (l.status === "duplicate" || l.status === "error") {
        next.status = "ready";
        next.error = null;
      }
      return next;
    }));

  const addVendor = (lotKey: string) => {
    setLots((xs) => xs.map((l) => {
      if (l.key !== lotKey) return l;
      const next: LotDraft = {
        ...l,
        vendors: [...l.vendors, { key: newKey(), vendor_name: "", vendor_id: null, bags: "", rate_per_bag: "" }],
      };
      if (l.status === "duplicate" || l.status === "error") {
        next.status = "ready";
        next.error = null;
      }
      return next;
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
      bhada_total: "",
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
    restoreScrollAfterLink();
  };

  const findOrCreateFarmer = useCallback(async (name: string): Promise<string | null> => {
    if (!name.trim()) return null;
    const found = findExactParty(farmers, name);
    if (found) return found.id;
    const created = await api.post<Farmer>("/farmers", { name: name.trim() });
    setFarmers((xs) => [...xs, created]);
    return created.id;
  }, [farmers]);

  const findOrCreateVendor = useCallback(async (name: string): Promise<string | null> => {
    if (!name.trim()) return null;
    const found = findExactParty(vendors, name);
    if (found) return found.id;
    const created = await api.post<Vendor>("/vendors", {
      name: name.trim(),
      details: `OCR · ${name.trim()}`,
    });
    setVendors((xs) => [...xs, created]);
    return created.id;
  }, [vendors]);

  const saveAll = async (mode: "save" | "print" = "save") => {
    // Staff may Save & Print once per Patti (server-tracked); Share is not offered here.
    const effectiveMode = mode;
    if (!day) { setError("Working-date auction day not loaded"); return; }
    setError(null); setSummary(null);
    setSaving(true);

    let ok = 0;
    let fail = 0;
    let dup = 0;
    const createdPattiIds: string[] = [];

    // Snapshot pending lots — each is validated/saved independently (no all-or-nothing).
    const pending = lots.filter(
      (l) => !l.saved && l.status !== "saved" && l.status !== "printed" && l.status !== "printing",
    );

    for (const lot of pending) {
      // Per-lot validation
      if (!lot.lot_serial_no.trim() || !lot.total_bags.trim() || !lot.farmer_name.trim()) {
        updateLot(lot.key, {
          status: "error",
          error: `Lot ${lot.lot_serial_no || "?"} — missing Lot No. / Total Bags / Farmer.`,
        });
        fail += 1;
        continue;
      }
      const filled = lot.vendors.filter(
        (v) => v.vendor_name.trim() && Number(v.bags) > 0 && Number(v.rate_per_bag) > 0,
      );
      if (!filled.length) {
        updateLot(lot.key, {
          status: "error",
          error: `Lot ${lot.lot_serial_no} — add at least one vendor sale.`,
        });
        fail += 1;
        continue;
      }
      const st = auctionStatus({ ...lot, vendors: filled });
      if (!st.ok) {
        updateLot(lot.key, { status: "error", error: st.message });
        fail += 1;
        continue;
      }

      updateLot(lot.key, { saving: true, status: "saving", error: null });
      try {
        let fid =
          lot.farmer_id ||
          fuzzyMatchId(lot.farmer_name, farmers.map((x) => ({ id: x.id, name: x.name })));
        if (!fid) fid = await findOrCreateFarmer(lot.farmer_name);
        if (!fid) throw new Error("Failed to find/create farmer");

        const sales: { vendor_id: string; bags: number; rate_per_bag: number }[] = [];
        for (const v of lot.vendors) {
          if (!v.vendor_name.trim() || !(Number(v.bags) > 0)) continue;
          let vid =
            v.vendor_id ||
            fuzzyMatchId(v.vendor_name, vendors.map((x) => ({ id: x.id, name: x.name })));
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
        if (lot.bhada_total.trim() !== "") {
          payload.bhada_total = Number(lot.bhada_total);
        }
        if (__DEV__) console.log("[lots] OCR save payload", JSON.stringify(payload));
        const savedLot = await api.post<Lot>("/lots", payload);
        const pattiId = savedLot?.patti_id || null;
        if (pattiId) createdPattiIds.push(pattiId);
        updateLot(lot.key, {
          saving: false,
          saved: true,
          status: "saved",
          error: null,
          patti_id: pattiId,
        });
        ok += 1;
      } catch (e: any) {
        const isDup = typeof e?.detail === "object" && e.detail?.code === "duplicate_lot";
        const insufficient = isInsufficientBagBalance(e);
        if (insufficient) handleBagBillingError(e, router);
        const msg = isDup
          ? "Lot already exists"
          : insufficient
            ? "Insufficient bag balance"
            : apiErrorMessage(e, "Farmer Patti generation failed");
        updateLot(lot.key, {
          saving: false,
          saved: false,
          status: isDup ? "duplicate" : "error",
          error: String(msg),
        });
        if (isDup) dup += 1;
        fail += 1;
      }
    }

    // SAVE & PRINT: print every successfully saved patti (including already-saved unprinted).
    if (effectiveMode === "print") {
      const extraIds = lots
        .filter((l) => (l.saved || l.status === "saved") && !l.printed && l.patti_id)
        .map((l) => l.patti_id as string)
        .filter((id) => !createdPattiIds.includes(id));
      const toPrint = [...createdPattiIds, ...extraIds];
      if (toPrint.length > 0) {
        try {
          const [profile, settingsDoc] = await Promise.all([
            api.get<ShopProfile>("/shop/profile").catch(() => null),
            api.get<any>("/settings").catch(() => null),
          ]);
          const paperMm = clampPaperMm(settingsDoc?.thermal_paper_width_mm || 80);
          for (const pid of toPrint) {
            setLots((xs) =>
              xs.map((l) =>
                l.patti_id === pid ? { ...l, status: "printing" as LotWorkflowStatus } : l,
              ),
            );
            try {
              const patti = await api.get<Patti>(`/pattis/${pid}`);
              if (!canUserPrintPatti(patti, session)) {
                setLots((xs) =>
                  xs.map((l) =>
                    l.patti_id === pid
                      ? { ...l, status: "printed" as LotWorkflowStatus, printed: true }
                      : l,
                  ),
                );
                continue;
              }
              await thermalPrintAndMark(patti, profile || ({ shop_name: "" } as any), paperMm, session, !!settingsDoc?.detailed_print_format);
              setLots((xs) =>
                xs.map((l) =>
                  l.patti_id === pid
                    ? { ...l, status: "printed" as LotWorkflowStatus, printed: true }
                    : l,
                ),
              );
            } catch (e) {
              console.warn("print patti failed", pid, e);
              setLots((xs) =>
                xs.map((l) =>
                  l.patti_id === pid
                    ? {
                        ...l,
                        status: "saved" as LotWorkflowStatus,
                        error: "Saved but print failed — tap SAVE & PRINT to retry print",
                      }
                    : l,
                ),
              );
            }
          }
        } catch (e) {
          console.warn("print pipeline failed", e);
        }
      }
    }

    setSaving(false);
    setSummary({ ok, fail });

    // fail = duplicates + validation/API errors still open on this screen
    const stillOpen = fail;

    const parts = [
      ok ? `${ok} saved` : null,
      effectiveMode === "print" && createdPattiIds.length ? `${createdPattiIds.length} sent to printer` : null,
      dup ? `${dup} duplicate kept on screen` : null,
      fail - dup > 0 ? `${fail - dup} failed` : null,
    ].filter(Boolean);

    if (ok > 0 || fail > 0) {
      Alert.alert(
        ok > 0 ? (fail > 0 ? "Partial success" : "Saved") : "Nothing saved",
        parts.join(" · ") +
          (stillOpen > 0
            ? "\n\nEdit or remove remaining lots, then SAVE / SAVE & PRINT again."
            : ""),
      );
    }

    // Leave review open while duplicates/errors remain (do not lose unsaved lots).
    // On full success → Create Lot menu (OCR + MANUAL), never Dashboard / stay on Review.
    if (stillOpen === 0 && ok > 0) {
      clearOcrSession();
      const r = router as typeof router & { dismissTo?: (href: string) => void };
      if (typeof r.dismissTo === "function") {
        r.dismissTo("/action-diary");
      } else {
        router.replace("/action-diary");
      }
    }
  };

  const statusLabel = (lot: LotDraft): { text: string; style: "ok" | "pending" | "warn" | "err" } | null => {
    switch (lot.status) {
      case "saving":
        return { text: "SAVING…", style: "pending" };
      case "saved":
        return { text: "✓ SAVED", style: "ok" };
      case "printing":
        return { text: "PRINTING…", style: "pending" };
      case "printed":
        return { text: "✓ PRINTED", style: "ok" };
      case "duplicate":
        return { text: "⚠ DUPLICATE", style: "warn" };
      case "error":
        return { text: "ERROR", style: "err" };
      default:
        if (lot.saving) return { text: "SAVING…", style: "pending" };
        if (lot.printed) return { text: "✓ PRINTED", style: "ok" };
        if (lot.saved) return { text: "✓ SAVED", style: "ok" };
        return null;
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
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={120}
        scrollEventThrottle={16}
        onScroll={(e: any) => {
          scrollYRef.current = e?.nativeEvent?.contentOffset?.y || 0;
        }}
      >
        {photoUri ? (
          <View style={styles.photoRef}>
            <Text style={styles.photoRefLabel}>PHOTO REFERENCE</Text>
            <Image source={{ uri: photoUri }} style={styles.photoRefImg} resizeMode="contain" />
          </View>
        ) : null}
        {lots.map((lot, li) => {
          const st = auctionStatus(lot);
          const badge = statusLabel(lot);
          const isDup = lot.status === "duplicate";
          const isDone = lot.saved || lot.status === "saved" || lot.status === "printed" || lot.status === "printing";
          return (
            <View
              key={lot.key}
              style={[
                styles.lotCard,
                isDone && styles.lotSaved,
                (isDup || lot.status === "error" || !!lot.error) && styles.lotErr,
                isDup && styles.lotDup,
              ]}
              testID={`ocr-lot-card-${li}`}
            >
              <View style={styles.lotHead}>
                <Text style={styles.lotHeadText}>LOT {lot.lot_serial_no || li + 1}</Text>
                {badge ? (
                  <Text
                    style={
                      badge.style === "ok"
                        ? styles.statusOk
                        : badge.style === "warn"
                          ? styles.statusWarn
                          : badge.style === "err"
                            ? styles.statusErr
                            : styles.statusPending
                    }
                  >
                    {badge.text}
                  </Text>
                ) : null}
                {!isDone ? (
                  <Pressable onPress={() => removeLot(lot.key)} hitSlop={10} testID={`ocr-lot-remove-${li}`}>
                    <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                  </Pressable>
                ) : null}
              </View>

              {isDup ? (
                <View style={styles.dupBanner} testID={`ocr-lot-dup-banner-${li}`}>
                  <Ionicons name="warning" size={16} color="#92400E" />
                  <Text style={styles.dupBannerText}>
                    Lot {lot.lot_serial_no || "?"} — Lot already exists
                  </Text>
                </View>
              ) : null}

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
                    label="LOT BHADA ₹"
                    value={lot.bhada_total}
                    onChangeText={(v) => updateLot(lot.key, { bhada_total: v.replace(/[^0-9.]/g, "") })}
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
              {lot.error && !isDup ? <Text style={styles.lotError}>{lot.error}</Text> : null}

              {isDup || lot.status === "error" ? (
                <View style={styles.dupActions}>
                  <Pressable
                    style={styles.dupRemoveBtn}
                    onPress={() => removeLot(lot.key)}
                    testID={`ocr-lot-close-dup-${li}`}
                  >
                    <Text style={styles.dupRemoveBtnText}>CLOSE / REMOVE DUPLICATE</Text>
                  </Pressable>
                  <Text style={styles.dupHint}>Edit Lot No. above, then tap SAVE or SAVE & PRINT</Text>
                </View>
              ) : null}
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
            <Text style={styles.sumLine}>
              {summary.ok} saved · {summary.fail} not saved · edit or remove remaining, then retry.
            </Text>
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

      <PartyPicker
        visible={!!pickerFor}
        kind={pickerFor?.kind === "vendor" ? "vendor" : "farmer"}
        items={pickerFor?.kind === "vendor" ? vendors : farmers}
        initialQuery={pickerQuery}
        onClose={() => { setPickerFor(null); setPickerQuery(""); }}
        onSelect={(item) => pickMaster(item.id, item.name)}
        onCreated={(item) => {
          if (pickerFor?.kind === "vendor") {
            setVendors((xs) => [...xs, item as Vendor]);
          } else {
            setFarmers((xs) => [...xs, item as Farmer]);
          }
          pickMaster(item.id, item.name);
        }}
      />
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
  lotDup: { borderColor: "#D97706", backgroundColor: "#FFFBEB" },
  lotHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm },
  lotHeadText: { flex: 1, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 13, color: colors.onSurface },
  statusPending: { fontSize: 11, color: colors.muted, fontFamily: font.display, fontWeight: "800" },
  statusOk: { fontSize: 11, color: "#065F46", fontFamily: font.display, fontWeight: "800" },
  statusWarn: { fontSize: 11, color: "#92400E", fontFamily: font.display, fontWeight: "800" },
  statusErr: { fontSize: 11, color: colors.error, fontFamily: font.display, fontWeight: "800" },
  dupBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.sm,
    backgroundColor: "#FEF3C7", borderWidth: 2, borderColor: "#F59E0B", padding: spacing.sm,
  },
  dupBannerText: { flex: 1, color: "#78350F", fontFamily: font.display, fontSize: 13, fontWeight: "800" },
  dupActions: { marginTop: spacing.sm, gap: 6 },
  dupRemoveBtn: {
    borderWidth: 2, borderColor: colors.error, paddingVertical: 10, alignItems: "center", backgroundColor: "#FEE2E2",
  },
  dupRemoveBtnText: { fontFamily: font.display, fontWeight: "900", letterSpacing: 0.5, fontSize: 11, color: colors.error },
  dupHint: { fontSize: 11, color: colors.muted, fontFamily: font.display, fontWeight: "600" },

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
