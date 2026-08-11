import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, AuctionDay, Farmer, Lot, Vendor } from "@/src/api";
import { Button, Empty, Input } from "@/src/components/ui";
import { colors, font, money, spacing } from "@/src/theme";
import { useWorkingDate } from "@/src/context/WorkingDateContext";

type LocalSale = { key: string; vendor_id: string | null; vendor_name: string; bags: string; rate: string };
const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function AddLot() {
  const { id, day: dayId } = useLocalSearchParams<{ id?: string; day?: string }>();
  const router = useRouter();
  const isEdit = !!id;
  const { workingDateISO, displayDate } = useWorkingDate();

  const [day, setDay] = useState<AuctionDay | null>(null);
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const [lotSerial, setLotSerial] = useState("");
  const [totalBags, setTotalBags] = useState("");
  const [farmerId, setFarmerId] = useState<string | null>(null);
  const [bhada, setBhada] = useState<string>("");
  const [bhadaManual, setBhadaManual] = useState(false);
  const [sales, setSales] = useState<LocalSale[]>([
    { key: newKey(), vendor_id: null, vendor_name: "", bags: "", rate: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [farmerPickerOpen, setFarmerPickerOpen] = useState(false);
  const [farmerSearch, setFarmerSearch] = useState("");
  const [showAddFarmer, setShowAddFarmer] = useState(false);
  const [newFarmerName, setNewFarmerName] = useState("");
  const [newFarmerVillage, setNewFarmerVillage] = useState("");

  const [vendorPickerFor, setVendorPickerFor] = useState<string | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");

  // Refs for smart auto-advance
  const lotNoRef = useRef<TextInput | null>(null);
  const totalBagsRef = useRef<TextInput | null>(null);
  const bhadaRef = useRef<TextInput | null>(null);
  const bagsRefs = useRef<Record<string, TextInput | null>>({});
  const rateRefs = useRef<Record<string, TextInput | null>>({});

  useEffect(() => {
    (async () => {
      try {
        const [f, v] = await Promise.all([api.get<Farmer[]>("/farmers"), api.get<Vendor[]>("/vendors")]);
        setFarmers(f); setVendors(v);
        const d = await api.get<AuctionDay>(`/auction-days/today?date=${workingDateISO}`);
        setDay(d);
        if (isEdit) {
          const l = await api.get<Lot>(`/lots?auction_day_id=${d.id}`).then((xs: any) => (xs as Lot[]).find((x) => x.id === id) || null);
          if (l) {
            setLotSerial(String(l.lot_serial_no ?? ""));
            setTotalBags(String(l.total_bags ?? ""));
            setFarmerId(l.farmer_id);
            setBhada(String(l.bhada_total ?? (l.bhada_per_bag * l.total_bags)));
            setBhadaManual(true);
            setSales(
              l.sales.length
                ? l.sales.map((s) => ({
                    key: newKey(), vendor_id: s.vendor_id, vendor_name: s.vendor_name,
                    bags: String(s.bags), rate: String(s.rate_per_bag),
                  }))
                : [{ key: newKey(), vendor_id: null, vendor_name: "", bags: "", rate: "" }],
            );
          }
        }
      } catch {
        // silent
      }
    })();
  }, [id, isEdit, dayId, workingDateISO]);

  // Auto-fill total bhada from driver when serial/total-bags/driver combine (only if not manually overridden)
  useEffect(() => {
    if (bhadaManual || !day) return;
    const n = parseInt(lotSerial.trim(), 10);
    const bags = parseInt(totalBags.trim(), 10);
    if (!isFinite(n) || n <= 0 || !isFinite(bags) || bags <= 0) return;
    const drv = day.drivers.find((d) => n >= d.range_from && n <= d.range_to);
    if (drv) setBhada(String(drv.bhada_per_bag * bags));
  }, [lotSerial, totalBags, day, bhadaManual]);

  const currentDriver = useMemo(() => {
    const n = parseInt(lotSerial.trim(), 10);
    if (!day || !isFinite(n)) return null;
    return day.drivers.find((d) => n >= d.range_from && n <= d.range_to) || null;
  }, [day, lotSerial]);

  const farmer = farmers.find((f) => f.id === farmerId) || null;

  const filteredFarmers = useMemo(() => {
    const q = farmerSearch.trim().toLowerCase();
    return q ? farmers.filter((f) => f.name.toLowerCase().includes(q)) : farmers;
  }, [farmers, farmerSearch]);
  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    return q ? vendors.filter((v) => v.name.toLowerCase().includes(q)) : vendors;
  }, [vendors, vendorSearch]);

  const soldBags = useMemo(() => sales.reduce((s, x) => s + (Number(x.bags) || 0), 0), [sales]);
  const totalGross = useMemo(() => sales.reduce((s, x) => s + (Number(x.bags) || 0) * (Number(x.rate) || 0), 0), [sales]);

  const updateSale = (k: string, patch: Partial<LocalSale>) =>
    setSales((xs) => xs.map((s) => (s.key === k ? { ...s, ...patch } : s)));
  const addSale = () => {
    const nk = newKey();
    setSales((xs) => [...xs, { key: nk, vendor_id: null, vendor_name: "", bags: "", rate: "" }]);
    // Focus the vendor picker of the new row after a tick
    setTimeout(() => setVendorPickerFor(nk), 100);
  };
  const removeSale = (k: string) =>
    setSales((xs) => (xs.length === 1 ? xs : xs.filter((s) => s.key !== k)));

  const onFarmerAddSave = async () => {
    if (!newFarmerName.trim()) return;
    try {
      const f = await api.post<Farmer>("/farmers", {
        name: newFarmerName.trim(),
        village: newFarmerVillage.trim() || null,
      });
      setFarmers((xs) => [...xs, f].sort((a, b) => a.name.localeCompare(b.name)));
      setFarmerId(f.id);
      setShowAddFarmer(false);
      setFarmerPickerOpen(false);
      setNewFarmerName(""); setNewFarmerVillage("");
    } catch (e: any) {
      Alert.alert("Failed", e?.detail || "Could not add");
    }
  };
  const onVendorAddSave = async () => {
    if (!newVendorName.trim()) return;
    try {
      const v = await api.post<Vendor>("/vendors", { name: newVendorName.trim() });
      setVendors((xs) => [...xs, v].sort((a, b) => a.name.localeCompare(b.name)));
      if (vendorPickerFor) updateSale(vendorPickerFor, { vendor_id: v.id, vendor_name: v.name });
      setShowAddVendor(false); setNewVendorName("");
      // Auto-advance to bags field
      setTimeout(() => {
        if (vendorPickerFor) bagsRefs.current[vendorPickerFor]?.focus();
      }, 100);
      setVendorPickerFor(null);
    } catch (e: any) {
      Alert.alert("Failed", e?.detail || "Could not add");
    }
  };

  const save = async (mode: "save" | "print" | "share" = "save") => {
    setError(null);
    const serial = parseInt(lotSerial.trim(), 10);
    const total = parseInt(totalBags.trim(), 10);
    if (!lotSerial.trim() || !isFinite(serial) || serial <= 0) { setError("Lot serial number required"); return; }
    if (!totalBags.trim() || !isFinite(total) || total <= 0) { setError("Total bags required"); return; }
    if (!farmerId) { setError("Farmer required"); return; }
    const salesClean = sales.filter((s) => s.vendor_id && Number(s.bags) > 0 && Number(s.rate) >= 0);
    if (salesClean.length === 0) { setError("Add at least one vendor sale"); return; }
    const salesBagsSum = salesClean.reduce((n, s) => n + Number(s.bags), 0);
    if (salesBagsSum !== total) {
      setError(`Sum of vendor bags (${salesBagsSum}) must equal total bags (${total}).`);
      return;
    }
    if (!day) return;

    const payload = {
      auction_day_id: day.id,
      lot_serial_no: serial,
      total_bags: total,
      farmer_id: farmerId,
      bhada_total: bhada.trim() ? Number(bhada) : null,
      sales: salesClean.map((s) => ({
        vendor_id: s.vendor_id!, bags: Number(s.bags), rate_per_bag: Number(s.rate),
      })),
    };

    try {
      setSaving(true);
      const savedLot = isEdit
        ? await api.put<Lot>(`/lots/${id}`, payload)
        : await api.post<Lot>("/lots", payload);
      const pattiId = savedLot?.patti_id || null;
      if (mode !== "save" && pattiId) {
        // Navigate to patti detail with auto-print or auto-share query flag.
        const param = mode === "print" ? "autoPrint" : "autoShare";
        router.replace({ pathname: "/patti/[id]", params: { id: pattiId, [param]: "1" } });
      } else {
        router.back();
      }
    } catch (e: any) {
      if (e?.status === 409 && typeof e?.detail === "object" && e.detail?.code === "duplicate_lot") {
        const existingId = e.detail.existing_lot_id;
        const farmer = e.detail.existing_farmer_name || "another farmer";
        const msg = e.detail.message || `Lot serial #${serial} already exists today for ${farmer}.`;
        setError(msg + " Tap SAVE again to retry after changing the serial.");
        Alert.alert(
          "⚠️ Duplicate lot",
          `${msg} Open the existing one instead?`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open existing", onPress: () => router.replace({ pathname: "/add-lot", params: { id: existingId, day: day.id } }) },
          ],
        );
      } else if (e?.status === 422 && typeof e?.detail === "object" && e.detail?.code === "bags_mismatch") {
        setError(e.detail.message || "Bags mismatch");
      } else {
        const d = e?.detail;
        setError(typeof d === "string" ? d : (d?.message || "Failed to save"));
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteLot = () => {
    if (!isEdit || !id) return;
    Alert.alert("Delete this lot?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try { await api.del(`/lots/${id}`); router.back(); }
          catch (e: any) { Alert.alert("Failed", e?.detail || "Could not delete"); }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="add-lot-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{isEdit ? "EDIT LOT" : "NEW LOT"}</Text>
          <Text style={styles.headerSub}>Action book · {day?.date || displayDate}</Text>
        </View>
        {isEdit && (
          <Pressable onPress={deleteLot} hitSlop={12} testID="add-lot-delete">
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          </Pressable>
        )}
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 220 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={120}
      >
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Input
                label="Lot Serial No."
                value={lotSerial}
                onChangeText={(v) => setLotSerial(v.replace(/[^0-9]/g, ""))}
                placeholder="e.g. 1"
                keyboardType="number-pad"
                testID="lot-serial"
                inputRef={lotNoRef}
                returnKeyType="next"
                onSubmitEditing={() => totalBagsRef.current?.focus()}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="Total Bags"
                value={totalBags}
                onChangeText={(v) => setTotalBags(v.replace(/[^0-9]/g, ""))}
                placeholder="e.g. 5"
                keyboardType="number-pad"
                testID="lot-total-bags"
                inputRef={totalBagsRef}
                returnKeyType="next"
                onSubmitEditing={() => setFarmerPickerOpen(true)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label={`Total Bhada ₹${bhadaManual ? " *" : ""}`}
                value={bhada}
                onChangeText={(v) => { setBhada(v.replace(/[^0-9.]/g, "")); setBhadaManual(true); }}
                keyboardType="decimal-pad"
                placeholder="Circled amount"
                testID="lot-bhada"
                inputRef={bhadaRef}
                returnKeyType="next"
                onSubmitEditing={addSale}
              />
            </View>
          </View>

          {currentDriver ? (
            <View style={styles.driverBanner}>
              <Ionicons name="car" size={14} color={colors.onBrandSecondary} />
              <Text style={styles.driverBannerText}>
                Driver: <Text style={{ fontWeight: "900" }}>{currentDriver.name}</Text>
                {currentDriver.place ? ` · ${currentDriver.place}` : ""}
                {" · ₹"}{currentDriver.bhada_per_bag}/bag
                {totalBags && parseInt(totalBags, 10) > 0 ? ` → ₹${currentDriver.bhada_per_bag * parseInt(totalBags, 10)} total` : ""}
              </Text>
              {bhadaManual && (
                <Pressable onPress={() => {
                  setBhadaManual(false);
                  const bags = parseInt(totalBags.trim(), 10);
                  setBhada(String(currentDriver.bhada_per_bag * (isFinite(bags) && bags > 0 ? bags : 1)));
                }} hitSlop={10}>
                  <Text style={styles.driverBannerReset}>RESET</Text>
                </Pressable>
              )}
            </View>
          ) : lotSerial ? (
            <View style={[styles.driverBanner, { backgroundColor: "#FEF3C7", borderColor: colors.warning }]}>
              <Ionicons name="warning-outline" size={14} color={colors.warning} />
              <Text style={[styles.driverBannerText, { color: "#78350F" }]}>
                No driver range covers lot #{lotSerial}. Set up drivers or enter total bhada manually.
              </Text>
            </View>
          ) : null}

          <Text style={styles.label}>Farmer</Text>
          <Pressable style={styles.pickBox} onPress={() => setFarmerPickerOpen(true)} testID="lot-farmer-pick">
            <Text style={[styles.pickBoxText, !farmer && { color: colors.muted }]} numberOfLines={1}>
              {farmer?.name || "Tap to select farmer"}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>

          <View style={styles.divider} />

          <View style={styles.salesHeader}>
            <Text style={styles.section}>Vendor Sales</Text>
            <Text style={styles.totalsPill}>{soldBags} / {totalBags || "?"} bags · {money(totalGross)}</Text>
          </View>

          {sales.map((s, idx) => (
            <View key={s.key} style={styles.saleCard} testID={`sale-card-${idx}`}>
              <View style={styles.saleHeader}>
                <Text style={styles.saleHeaderText}>SALE {idx + 1}</Text>
                {sales.length > 1 && (
                  <Pressable onPress={() => removeSale(s.key)} hitSlop={10} testID={`sale-remove-${idx}`}>
                    <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                  </Pressable>
                )}
              </View>

              <Text style={styles.smallLabel}>Vendor</Text>
              <Pressable
                style={styles.pickBox}
                onPress={() => { setVendorPickerFor(s.key); setVendorSearch(""); }}
                testID={`sale-vendor-${idx}`}
              >
                <Text style={[styles.pickBoxText, !s.vendor_id && { color: colors.muted }]} numberOfLines={1}>
                  {s.vendor_name || "Tap to select vendor"}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>

              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Bags"
                    value={s.bags}
                    onChangeText={(v) => updateSale(s.key, { bags: v.replace(/[^0-9]/g, "") })}
                    keyboardType="number-pad"
                    placeholder="0"
                    testID={`sale-bags-${idx}`}
                    inputRef={(r) => { bagsRefs.current[s.key] = r; }}
                    returnKeyType="next"
                    onSubmitEditing={() => rateRefs.current[s.key]?.focus()}
                  />
                </View>
                <View style={{ flex: 1.4 }}>
                  <Input
                    label="Rate / bag ₹"
                    value={s.rate}
                    onChangeText={(v) => updateSale(s.key, { rate: v.replace(/[^0-9.]/g, "") })}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    testID={`sale-rate-${idx}`}
                    inputRef={(r) => { rateRefs.current[s.key] = r; }}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      // Do not auto-add a new vendor row. User must explicitly click "+ ADD ANOTHER VENDOR".
                    }}
                  />
                </View>
              </View>

              {Number(s.bags) > 0 && Number(s.rate) > 0 ? (
                <View style={styles.saleTotalRow}>
                  <Text style={styles.saleTotalLabel}>SUBTOTAL</Text>
                  <Text style={styles.saleTotalValue}>{money(Number(s.bags) * Number(s.rate))}</Text>
                </View>
              ) : null}
            </View>
          ))}

          <Pressable style={styles.addRow} onPress={addSale} testID="add-sale">
            <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
            <Text style={styles.addRowText}>ADD ANOTHER VENDOR</Text>
          </Pressable>
      </KeyboardAwareScrollView>

      <KeyboardStickyView>
        <View style={styles.footer}>
          {error ? <Text style={styles.err}>{error}</Text> : null}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.actionSave, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}
              onPress={() => save("save")}
              disabled={saving}
              testID="save-lot"
            >
              <Ionicons name="save-outline" size={16} color={colors.onSurface} />
              <Text style={[styles.actionBtnText, { color: colors.onSurface }]}>SAVE</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.actionPrint, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}
              onPress={() => save("print")}
              disabled={saving}
              testID="save-and-print-lot"
            >
              <Ionicons name="print-outline" size={16} color={colors.onSurfaceInverse} />
              <Text style={[styles.actionBtnText, { color: colors.onSurfaceInverse }]}>SAVE & PRINT</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.actionShare, pressed && { opacity: 0.85 }, saving && { opacity: 0.5 }]}
              onPress={() => save("share")}
              disabled={saving}
              testID="save-and-share-lot"
            >
              <Ionicons name="share-social-outline" size={16} color={colors.onBrandPrimary} />
              <Text style={[styles.actionBtnText, { color: colors.onBrandPrimary }]}>SHARE</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>

      {/* Farmer picker */}
      <Modal visible={farmerPickerOpen} animationType="slide" transparent onRequestClose={() => setFarmerPickerOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setFarmerPickerOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SELECT FARMER</Text>
              <Pressable onPress={() => setFarmerPickerOpen(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.muted} />
              <TextInput
                value={farmerSearch}
                onChangeText={setFarmerSearch}
                placeholder="Search farmers…"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                testID="farmer-search"
              />
            </View>
            <FlatList
              data={filteredFarmers}
              keyExtractor={(x) => x.id}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
              ListEmptyComponent={<Empty title="No farmers" subtitle="Tap add below" />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setFarmerId(item.id);
                    setFarmerPickerOpen(false);
                    setTimeout(() => bhadaRef.current?.focus(), 200);
                  }}
                  style={[styles.pickRow, item.id === farmerId && styles.pickRowSelected]}
                  testID={`farmer-pick-${item.id}`}
                >
                  <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickTitle}>{item.name}</Text>
                    <Text style={styles.pickMeta}>{item.village || "—"}</Text>
                  </View>
                </Pressable>
              )}
              ListFooterComponent={
                <Pressable style={styles.addRow} onPress={() => setShowAddFarmer(true)} testID="farmer-add-btn">
                  <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
                  <Text style={styles.addRowText}>ADD NEW FARMER</Text>
                </Pressable>
              }
            />
          </View>
        </View>
      </Modal>

      {/* Vendor picker */}
      <Modal visible={!!vendorPickerFor} animationType="slide" transparent onRequestClose={() => setVendorPickerFor(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setVendorPickerFor(null)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>SELECT VENDOR</Text>
              <Pressable onPress={() => setVendorPickerFor(null)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.muted} />
              <TextInput
                value={vendorSearch}
                onChangeText={setVendorSearch}
                placeholder="Search vendors…"
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                testID="vendor-search"
              />
            </View>
            <FlatList
              data={filteredVendors}
              keyExtractor={(x) => x.id}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 380 }}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
              ListEmptyComponent={<Empty title="No vendors" subtitle="Tap add below" />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    if (vendorPickerFor) {
                      updateSale(vendorPickerFor, { vendor_id: item.id, vendor_name: item.name });
                      const k = vendorPickerFor;
                      setVendorPickerFor(null);
                      setTimeout(() => bagsRefs.current[k]?.focus(), 200);
                    }
                  }}
                  style={styles.pickRow}
                  testID={`vendor-pick-${item.id}`}
                >
                  <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text></View>
                  <Text style={[styles.pickTitle, { flex: 1 }]}>{item.name}</Text>
                </Pressable>
              )}
              ListFooterComponent={
                <Pressable style={styles.addRow} onPress={() => setShowAddVendor(true)} testID="vendor-add-btn">
                  <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
                  <Text style={styles.addRowText}>ADD NEW VENDOR</Text>
                </Pressable>
              }
            />
          </View>
        </View>
      </Modal>

      {/* Add farmer / vendor inline modals */}
      <Modal visible={showAddFarmer} transparent animationType="fade" onRequestClose={() => setShowAddFarmer(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setShowAddFarmer(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>ADD FARMER</Text>
              <Pressable onPress={() => setShowAddFarmer(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ padding: spacing.lg }}>
              <Input label="Name" value={newFarmerName} onChangeText={setNewFarmerName} autoCapitalize="words" testID="new-farmer-name" />
              <Input label="Village (optional)" value={newFarmerVillage} onChangeText={setNewFarmerVillage} testID="new-farmer-village" />
              <Button label="ADD" onPress={onFarmerAddSave} testID="new-farmer-save" />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={showAddVendor} transparent animationType="fade" onRequestClose={() => setShowAddVendor(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={styles.backdrop} onPress={() => setShowAddVendor(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>ADD VENDOR</Text>
              <Pressable onPress={() => setShowAddVendor(false)} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ padding: spacing.lg }}>
              <Input label="Name" value={newVendorName} onChangeText={setNewVendorName} autoCapitalize="words" testID="new-vendor-name" />
              <Button label="ADD" onPress={onVendorAddSave} testID="new-vendor-save" />
            </View>
          </View>
        </KeyboardAvoidingView>
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
  headerTitle: { fontSize: 20, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  headerSub: { fontSize: 11, color: colors.muted, fontFamily: font.display, letterSpacing: 1, fontWeight: "700" },

  label: {
    fontSize: 12, fontWeight: "800", color: colors.onSurfaceTertiary,
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontFamily: font.display,
  },
  smallLabel: {
    fontSize: 11, fontWeight: "800", color: colors.onSurfaceTertiary,
    textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontFamily: font.display,
  },
  pickBox: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 14, minHeight: 48,
    marginBottom: spacing.md,
  },
  pickBoxText: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 16 },

  driverBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.brandSecondary, borderWidth: 2, borderColor: colors.brandPrimary,
    padding: spacing.sm, marginBottom: spacing.md,
  },
  driverBannerText: { flex: 1, fontSize: 12, color: colors.onBrandSecondary, fontFamily: font.display, fontWeight: "700" },
  driverBannerReset: { fontSize: 10, color: colors.brand, fontFamily: font.display, fontWeight: "900", letterSpacing: 1 },

  divider: { height: 2, backgroundColor: colors.divider, marginVertical: spacing.md },

  section: {
    fontSize: 12, letterSpacing: 2, color: colors.muted, textTransform: "uppercase",
    fontFamily: font.display, fontWeight: "800",
  },
  salesHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  totalsPill: {
    fontFamily: font.mono, fontWeight: "800", fontSize: 12,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: 8, paddingVertical: 2, color: colors.onSurface,
  },

  saleCard: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.sm },
  saleHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  saleHeaderText: { fontSize: 11, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 1.5 },

  saleTotalRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.surfaceSecondary, borderWidth: 2, borderColor: colors.borderStrong,
    padding: spacing.sm, marginTop: spacing.sm,
  },
  saleTotalLabel: { fontSize: 11, fontFamily: font.display, fontWeight: "800", letterSpacing: 1, color: colors.onSurfaceTertiary },
  saleTotalValue: { fontSize: 15, fontFamily: font.mono, fontWeight: "800", color: colors.onSurface },

  addRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    borderWidth: 2, borderColor: colors.brandPrimary, borderStyle: "dashed",
    padding: spacing.md, marginTop: spacing.sm,
  },
  addRowText: { color: colors.brandPrimary, fontFamily: font.display, fontWeight: "800", letterSpacing: 1 },

  footer: {
    borderTopWidth: 2, borderTopColor: colors.borderStrong,
    padding: spacing.lg, backgroundColor: colors.surface, gap: spacing.sm,
  },
  actionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 2, paddingVertical: 14, minHeight: 48,
  },
  actionSave: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  actionPrint: { borderColor: colors.surfaceInverse, backgroundColor: colors.surfaceInverse },
  actionShare: { borderColor: colors.brand, backgroundColor: colors.brandPrimary },
  actionBtnText: { fontFamily: font.display, fontWeight: "900", letterSpacing: 0.5, fontSize: 11 },
  err: {
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, fontFamily: font.display, fontWeight: "700",
  },

  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  modalSheet: { backgroundColor: colors.surface, borderTopWidth: 2, borderColor: colors.borderStrong, paddingBottom: spacing.xl },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, borderBottomWidth: 2, borderBottomColor: colors.borderStrong },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 1 },

  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 15, paddingVertical: 8 },
  pickRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface,
  },
  pickRowSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  pickTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  pickMeta: { fontSize: 12, color: colors.muted, fontFamily: font.display, marginTop: 2 },
  avatar: {
    width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSecondary,
  },
  avatarText: { fontSize: 16, fontWeight: "900", color: colors.onBrandSecondary, fontFamily: font.display },
});
