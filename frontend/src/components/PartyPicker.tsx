import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  FlatList, Modal,
  Pressable, StyleSheet, Text, TextInput, View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { api, Farmer, Vendor } from "@/src/api";
import { KeyboardFormAvoid } from "@/src/components/KeyboardForm";
import { Button, Empty, Input } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";

export type PartyKind = "farmer" | "vendor";
export type PartyItem = Farmer | Vendor;

function normName(s: string): string {
  return (s || "").trim().toLowerCase();
}

export function findExactParty<T extends { name: string }>(list: T[], name: string): T | undefined {
  const n = normName(name);
  if (!n) return undefined;
  return list.find((x) => normName(x.name) === n);
}

export function findSimilarParties<T extends { name: string }>(list: T[], name: string): T[] {
  const n = normName(name);
  if (n.length < 2) return [];
  return list.filter((x) => {
    const t = normName(x.name);
    return t === n || t.includes(n) || n.includes(t);
  }).slice(0, 8);
}

function focusTextInputRef(ref: React.RefObject<TextInput | null>) {
  const input = ref.current;
  if (!input) return;
  try {
    input.focus();
  } catch {
    /* ignore */
  }
  try {
    const native =
      (input as TextInput & { getNativeRef?: () => HTMLElement }).getNativeRef?.() ??
      (input as TextInput & { _nativeRef?: HTMLElement })._nativeRef ??
      input;
    if (native && typeof (native as HTMLElement).focus === "function") {
      (native as HTMLElement).focus();
      const el = native as HTMLInputElement;
      if (typeof el.setSelectionRange === "function" && typeof el.value === "string") {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    }
  } catch {
    /* ignore */
  }
}

function focusTextInputSoon(ref: React.RefObject<TextInput | null>) {
  const run = () => focusTextInputRef(ref);
  run();
  requestAnimationFrame(() => {
    run();
    requestAnimationFrame(run);
  });
  setTimeout(run, 50);
  setTimeout(run, 150);
  setTimeout(run, 350);
}

export function PartyPicker({
  visible,
  kind,
  items,
  selectedId,
  initialQuery = "",
  onClose,
  onSelect,
  onCreated,
}: {
  visible: boolean;
  kind: PartyKind;
  items: PartyItem[];
  selectedId?: string | null;
  initialQuery?: string;
  onClose: () => void;
  onSelect: (item: PartyItem) => void;
  onCreated: (item: PartyItem) => void;
}) {
  const isFarmer = kind === "farmer";
  const title = isFarmer ? "LINK FARMER" : "LINK VENDOR";
  const addLabel = isFarmer ? "+ ADD NEW FARMER" : "+ ADD NEW VENDOR";
  const searchPlaceholder = isFarmer ? "Search Farmer…" : "Search Vendor…";

  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [village, setVillage] = useState("");
  const [details, setDetails] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [createAction, setCreateAction] = useState<"save" | "cancel">("save");
  const [createActionsActive, setCreateActionsActive] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<PartyItem>>(null);
  const nameRef = useRef<TextInput>(null);
  const detailsRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const villageRef = useRef<TextInput>(null);
  const createKeyRef = useRef<TextInput>(null);
  const createActionRef = useRef<"save" | "cancel">("save");
  const suppressCreateEnterUntilRef = useRef(0);
  const nameFocusPendingRef = useRef(false);
  const searchFocusPendingRef = useRef(false);
  createActionRef.current = createAction;

  const shouldIgnoreCreateEnter = () => Date.now() < suppressCreateEnterUntilRef.current;

  useEffect(() => {
    if (!visible) return;
    setQuery(initialQuery || "");
    setShowCreate(false);
    setFormError(null);
    setHighlightIndex(0);
    searchFocusPendingRef.current = true;
  }, [visible, initialQuery, kind]);

  const focusSearchInput = useCallback(() => {
    focusTextInputSoon(searchRef);
  }, []);

  const handleSearchModalShown = useCallback(() => {
    setHighlightIndex(0);
    focusSearchInput();
  }, [focusSearchInput]);

  const handleSearchLayout = useCallback(() => {
    if (!searchFocusPendingRef.current) return;
    searchFocusPendingRef.current = false;
    focusSearchInput();
  }, [focusSearchInput]);

  useLayoutEffect(() => {
    if (!visible || showCreate) return;
    searchFocusPendingRef.current = true;
    focusSearchInput();
  }, [visible, showCreate, kind, focusSearchInput]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, items.length, kind]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items;
    return q ? list.filter((x) => x.name.toLowerCase().includes(q)
      || (isFarmer && ((x as Farmer).village || "").toLowerCase().includes(q))
      || (!isFarmer && ((x as Vendor).details || "").toLowerCase().includes(q))
      || ((x.phone || "").includes(q))) : list;
  }, [items, query, isFarmer]);

  const matches = useMemo(() => findSimilarParties(items, name), [items, name]);
  const exact = useMemo(() => findExactParty(items, name), [items, name]);

  type CreateField = "name" | "details" | "phone" | "village";

  const createFieldOrder = useMemo((): CreateField[] => {
    if (isFarmer) return ["name", "phone", "village"];
    return ["name", "details", "phone"];
  }, [isFarmer]);

  const createFieldRef = (field: CreateField) => {
    if (field === "name") return nameRef;
    if (field === "details") return detailsRef;
    if (field === "phone") return phoneRef;
    return villageRef;
  };

  const focusCreateField = (field: CreateField) => {
    setCreateActionsActive(false);
    focusTextInputSoon(createFieldRef(field));
  };

  const focusCreateNameInput = useCallback(() => {
    searchRef.current?.blur();
    focusTextInputSoon(nameRef);
  }, []);

  const submitCreateField = (field: CreateField) => {
    if (shouldIgnoreCreateEnter()) return;
    advanceCreateField(field);
  };

  const handleCreateModalShown = useCallback(() => {
    setCreateAction("save");
    setCreateActionsActive(false);
    focusCreateNameInput();
  }, [focusCreateNameInput]);

  const handleCreateNameLayout = useCallback(() => {
    if (!nameFocusPendingRef.current) return;
    nameFocusPendingRef.current = false;
    focusCreateNameInput();
  }, [focusCreateNameInput]);

  const closeCreate = () => {
    setShowCreate(false);
    setCreateActionsActive(false);
    setCreateAction("save");
  };

  const activateCreateActions = (action: "save" | "cancel" = "save") => {
    suppressCreateEnterUntilRef.current = 0;
    setCreateAction(action);
    setCreateActionsActive(true);
    nameRef.current?.blur();
    detailsRef.current?.blur();
    phoneRef.current?.blur();
    villageRef.current?.blur();
  };

  const advanceCreateField = (field: CreateField) => {
    const idx = createFieldOrder.indexOf(field);
    const next = idx >= 0 ? createFieldOrder[idx + 1] : undefined;
    if (next) {
      focusCreateField(next);
      return;
    }
    activateCreateActions("save");
  };

  const runCreateAction = (action: "save" | "cancel") => {
    if (action !== "cancel" && shouldIgnoreCreateEnter()) return;
    if (action === "cancel") {
      closeCreate();
      return;
    }
    if (exact) {
      selectExistingParty(exact);
      return;
    }
    saveNew();
  };

  const handleCreateFormKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = e.nativeEvent.key;
    if (key === "Escape") {
      closeCreate();
      return;
    }
    if (!createActionsActive) return;
    if (key === "ArrowLeft") setCreateAction("save");
    else if (key === "ArrowRight") setCreateAction("cancel");
    else if (key === "Enter") runCreateAction(createActionRef.current);
  };

  const handleCreateFieldKeyPress = (_field: CreateField) => (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) => {
    if (e.nativeEvent.key === "Escape") closeCreate();
  };

  const handleCreateFieldFocus = () => {
    setCreateActionsActive(false);
  };

  useLayoutEffect(() => {
    if (!visible || !showCreate) return;
    setCreateAction("save");
    setCreateActionsActive(false);
    focusCreateNameInput();
  }, [visible, showCreate, kind, focusCreateNameInput]);

  useEffect(() => {
    if (!showCreate || !createActionsActive) return;
    focusTextInputSoon(createKeyRef);
  }, [showCreate, createActionsActive, createAction]);

  const openCreate = () => {
    searchRef.current?.blur();
    suppressCreateEnterUntilRef.current = Date.now() + 650;
    nameFocusPendingRef.current = true;
    setCreateAction("save");
    setCreateActionsActive(false);
    setName((query || initialQuery || "").trim());
    setPhone("");
    setVillage("");
    setDetails("");
    setFormError(null);
    setShowCreate(true);
  };

  const confirmHighlighted = () => {
    if (filtered.length === 0) {
      if (query.trim()) openCreate();
      return;
    }
    const idx = Math.min(Math.max(highlightIndex, 0), filtered.length - 1);
    onSelect(filtered[idx]);
  };

  const handleSearchKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = e.nativeEvent.key;
    if (key === "ArrowDown") {
      if (!filtered.length) return;
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (key === "ArrowUp") {
      if (!filtered.length) return;
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (key === "Enter") {
      if (filtered.length === 0 && query.trim()) {
        suppressCreateEnterUntilRef.current = Date.now() + 650;
        nameFocusPendingRef.current = true;
      }
      confirmHighlighted();
    }
  };

  useEffect(() => {
    if (!visible || showCreate || !filtered.length) return;
    const idx = Math.min(highlightIndex, filtered.length - 1);
    try {
      listRef.current?.scrollToIndex({ index: idx, animated: false });
    } catch {
      /* layout not ready */
    }
  }, [visible, showCreate, highlightIndex, filtered.length]);

  const selectExistingParty = (item: PartyItem) => {
    setShowCreate(false);
    setCreateActionsActive(false);
    onSelect(item);
  };

  const saveNew = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError("Name is required");
      focusCreateField("name");
      return;
    }
    const existing = findExactParty(items, trimmed);
    if (existing) {
      selectExistingParty(existing);
      return;
    }
    if (!isFarmer && !details.trim()) {
      setFormError("Vendor Details are required (e.g. shop name / village)");
      focusCreateField("details");
      return;
    }
    try {
      setSaving(true);
      setFormError(null);
      const body: Record<string, string | null> = {
        name: trimmed,
        phone: phone.trim() || null,
      };
      if (isFarmer) body.village = village.trim() || null;
      else body.details = details.trim();
      const created = await api.post<PartyItem>(isFarmer ? "/farmers" : "/vendors", body);
      setShowCreate(false);
      setCreateActionsActive(false);
      onCreated(created);
    } catch (e: any) {
      const existingAfter = findExactParty(items, trimmed);
      if (existingAfter) {
        selectExistingParty(existingAfter);
        return;
      }
      setFormError(e?.detail || "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible && !showCreate}
        transparent
        animationType="slide"
        onRequestClose={onClose}
        onShow={handleSearchModalShown}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12} testID="party-picker-close">
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <Pressable
              style={styles.addNew}
              onPress={openCreate}
              testID={isFarmer ? "farmer-add-btn" : "vendor-add-btn"}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.brandPrimary} />
              <Text style={styles.addNewText}>{addLabel}</Text>
            </Pressable>

            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.muted} />
              <TextInput
                ref={searchRef}
                value={query}
                onChangeText={setQuery}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                autoCapitalize="none"
                returnKeyType="search"
                blurOnSubmit={false}
                onLayout={handleSearchLayout}
                onSubmitEditing={() => {
                  if (filtered.length === 0 && query.trim()) {
                    suppressCreateEnterUntilRef.current = Date.now() + 650;
                    nameFocusPendingRef.current = true;
                  }
                  confirmHighlighted();
                }}
                onKeyPress={handleSearchKeyPress}
                testID={isFarmer ? "farmer-search" : "vendor-search"}
              />
            </View>

            <FlatList
              ref={listRef}
              data={filtered}
              keyExtractor={(x) => x.id}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 360 }}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm }}
              onScrollToIndexFailed={() => {
                /* ignore — list may still be measuring */
              }}
              ListEmptyComponent={
                <Empty
                  title={isFarmer ? "No farmers" : "No vendors"}
                  subtitle={`Type a name and press Enter to add, or tap ${addLabel} above`}
                />
              }
              renderItem={({ item, index }) => (
                <Pressable
                  onPress={() => onSelect(item)}
                  style={[
                    styles.row,
                    item.id === selectedId && styles.rowOn,
                    index === highlightIndex && styles.rowHighlight,
                  ]}
                  testID={`party-pick-${item.id}`}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.name}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {isFarmer
                        ? ((item as Farmer).village || item.phone || "—")
                        : ((item as Vendor).details || item.phone || "—")}
                    </Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={visible && showCreate}
        transparent
        animationType="fade"
        onRequestClose={closeCreate}
        onShow={handleCreateModalShown}
      >
        <KeyboardFormAvoid style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeCreate} />
          <View style={styles.createCard} testID={isFarmer ? "new-farmer-form" : "new-vendor-form"}>
            <View style={styles.header}>
              <Text style={styles.title}>{isFarmer ? "ADD FARMER" : "ADD VENDOR"}</Text>
              <Pressable onPress={closeCreate} hitSlop={12}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
            <Input
              label="Name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              placeholder="Full name"
              testID={isFarmer ? "new-farmer-name" : "new-vendor-name"}
              inputRef={nameRef}
              returnKeyType="next"
              blurOnSubmit={false}
              onLayout={handleCreateNameLayout}
              onFocus={handleCreateFieldFocus}
              onSubmitEditing={() => submitCreateField("name")}
              onKeyPress={handleCreateFieldKeyPress("name")}
            />
            {!isFarmer ? (
              <Input
                label="Vendor Details (required)"
                value={details}
                onChangeText={setDetails}
                placeholder="e.g. shop name / village"
                autoCapitalize="words"
                testID="new-vendor-details"
                inputRef={detailsRef}
                returnKeyType="next"
                blurOnSubmit={false}
                onFocus={handleCreateFieldFocus}
                onSubmitEditing={() => submitCreateField("details")}
                onKeyPress={handleCreateFieldKeyPress("details")}
              />
            ) : null}
            <Input
              label="Phone (optional)"
              value={phone}
              onChangeText={setPhone}
              placeholder="10-digit mobile"
              keyboardType="phone-pad"
              testID={isFarmer ? "new-farmer-phone" : "new-vendor-phone"}
              inputRef={phoneRef}
              returnKeyType="next"
              blurOnSubmit={false}
              onFocus={handleCreateFieldFocus}
              onSubmitEditing={() => submitCreateField("phone")}
              onKeyPress={handleCreateFieldKeyPress("phone")}
            />
            {isFarmer ? (
              <Input
                label="Village (optional)"
                value={village}
                onChangeText={setVillage}
                placeholder="Village / town"
                testID="new-farmer-village"
                inputRef={villageRef}
                returnKeyType="done"
                blurOnSubmit={false}
                onFocus={handleCreateFieldFocus}
                onSubmitEditing={() => submitCreateField("village")}
                onKeyPress={handleCreateFieldKeyPress("village")}
              />
            ) : null}

            {exact ? (
              <Pressable
                style={styles.matchBanner}
                onPress={() => selectExistingParty(exact)}
                testID="party-use-existing"
              >
                <Ionicons name="alert-circle-outline" size={16} color="#78350F" />
                <Text style={styles.matchText}>
                  “{exact.name}” already exists. Tap to use this saved record instead of creating a duplicate.
                </Text>
              </Pressable>
            ) : matches.length ? (
              <View style={styles.matchList}>
                <Text style={styles.matchLabel}>EXISTING MATCHES — TAP TO SELECT</Text>
                {matches.map((m) => (
                  <Pressable
                    key={m.id}
                    style={styles.matchRow}
                    onPress={() => selectExistingParty(m)}
                  >
                    <Text style={styles.rowTitle}>{m.name}</Text>
                    <Text style={styles.rowMeta}>
                      {isFarmer ? ((m as Farmer).village || "—") : ((m as Vendor).details || "—")}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {formError ? <Text style={styles.err}>{formError}</Text> : null}

            {createActionsActive ? (
              <TextInput
                ref={createKeyRef}
                style={styles.createKeyTrap}
                showSoftInputOnFocus={false}
                caretHidden
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                onKeyPress={handleCreateFormKeyPress}
                testID="party-create-key-trap"
              />
            ) : null}

            <View style={styles.createActions}>
              <Button
                label={saving ? "SAVING…" : exact ? "USE EXISTING" : "SAVE & LINK"}
                onPress={exact ? () => selectExistingParty(exact) : saveNew}
                loading={saving}
                focusable={createActionsActive}
                style={{
                  ...styles.createActionBtn,
                  ...(createActionsActive && createAction === "save" ? styles.createActionFocus : null),
                }}
                testID={isFarmer ? "new-farmer-save" : "new-vendor-save"}
              />
              <Button
                label="CANCEL"
                variant="secondary"
                onPress={closeCreate}
                focusable={createActionsActive}
                style={{
                  ...styles.createActionBtn,
                  ...(createActionsActive && createAction === "cancel" ? styles.createActionFocus : null),
                }}
                testID={isFarmer ? "new-farmer-cancel" : "new-vendor-cancel"}
              />
            </View>
            </View>
          </View>
        </KeyboardFormAvoid>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: colors.surface, borderTopWidth: 2, borderColor: colors.borderStrong,
    paddingBottom: spacing.md, maxHeight: "82%",
  },
  createCard: {
    backgroundColor: colors.surface, borderTopWidth: 2, borderColor: colors.borderStrong,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  title: { fontSize: 16, fontWeight: "900", color: colors.onSurface, fontFamily: font.display, letterSpacing: 1 },
  addNew: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.md,
    borderWidth: 2, borderColor: colors.brandPrimary, borderStyle: "dashed",
    paddingVertical: 12, paddingHorizontal: spacing.md,
  },
  addNewText: { color: colors.brandPrimary, fontFamily: font.display, fontWeight: "900", letterSpacing: 1, fontSize: 13 },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.sm,
    borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.md, height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 15, paddingVertical: 8 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, backgroundColor: colors.surface,
  },
  rowOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandSecondary },
  rowHighlight: { borderColor: colors.brand, backgroundColor: colors.brandSecondary },
  rowTitle: { fontSize: 15, fontWeight: "800", color: colors.onSurface, fontFamily: font.display },
  rowMeta: { fontSize: 12, color: colors.muted, fontFamily: font.display, marginTop: 2 },
  avatar: {
    width: 40, height: 40, borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.brandSecondary,
  },
  avatarText: { fontFamily: font.display, fontWeight: "900", color: colors.onSurface },
  matchBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#FEF3C7", borderWidth: 2, borderColor: "#F59E0B",
    padding: spacing.sm, marginBottom: spacing.md,
  },
  matchText: { flex: 1, color: "#78350F", fontFamily: font.display, fontSize: 12, fontWeight: "700" },
  matchList: { marginBottom: spacing.md, borderWidth: 2, borderColor: colors.borderStrong },
  matchLabel: {
    fontSize: 10, letterSpacing: 1.2, fontWeight: "900", fontFamily: font.display,
    color: colors.muted, paddingHorizontal: spacing.sm, paddingTop: spacing.sm,
  },
  matchRow: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  createActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  createActionBtn: { flex: 1 },
  createActionFocus: { borderWidth: 3, borderColor: colors.brand },
  createKeyTrap: { position: "absolute", width: 1, height: 1, opacity: 0, top: 0, left: 0 },
  err: {
    color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error,
    padding: spacing.sm, fontFamily: font.display, fontWeight: "700", marginBottom: spacing.sm,
  },
});
