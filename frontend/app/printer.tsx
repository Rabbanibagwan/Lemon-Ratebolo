import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { api, Settings as SettingsT } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { Button } from "@/src/components/ui";
import { colors, font, spacing } from "@/src/theme";
import {
  BluetoothDevice,
  bluetoothHardwareAvailable,
  bluetoothPrinterConnected,
  bluetoothUserMessage,
  listBondedPrinters,
  openAndroidBluetoothSettings,
  startPrinterScan,
  stopPrinterScan,
  watchDiscoveredPrinters,
} from "@/src/utils/bluetooth-printer";
import { loadPrinterPrefs, PrinterConnectionType, savePrinterPrefs } from "@/src/utils/printer-prefs";
import { ThermalPrinterService } from "@/src/utils/thermal-printer-service";
import { clampPaperMm, THERMAL_PAPER_PRESETS } from "@/src/utils/thermal-print";

export default function PrinterSettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const isOwner = session?.role === "owner";

  const [connectionType, setConnectionType] = useState<PrinterConnectionType>("WIFI");
  const [printerId, setPrinterId] = useState("");
  const [printerName, setPrinterName] = useState("");
  const [paperWidth, setPaperWidth] = useState(80);
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [connected, setConnected] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = await loadPrinterPrefs();
    setConnectionType(p.connectionType);
    setPrinterId(p.printerId);
    setPrinterName(p.printerName);
    setPaperWidth(p.paperWidth);
    try {
      const s = await api.get<SettingsT>("/settings");
      if (s?.thermal_paper_width_mm) {
        const w = clampPaperMm(s.thermal_paper_width_mm);
        setPaperWidth(w);
        if (w !== p.paperWidth) await savePrinterPrefs({ paperWidth: w });
      }
    } catch { /* keep local */ }
    setConnected(await bluetoothPrinterConnected());
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return () => { stopPrinterScan().catch(() => undefined); };
  }, []);

  const nativeOk = bluetoothHardwareAvailable();

  const mergeDevice = (d: BluetoothDevice) => {
    setDevices((xs) => {
      if (xs.some((x) => x.id === d.id)) return xs.map((x) => (x.id === d.id ? d : x));
      return [...xs, d].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const persist = async (patch: Parameters<typeof savePrinterPrefs>[0]) => {
    const next = await savePrinterPrefs(patch);
    setConnectionType(next.connectionType);
    setPrinterId(next.printerId);
    setPrinterName(next.printerName);
    setPaperWidth(next.paperWidth);
    return next;
  };

  const setPaper = async (w: number) => {
    await persist({ paperWidth: w });
    if (!isOwner) return;
    try {
      const s = await api.get<SettingsT>("/settings");
      await api.put("/settings", { ...s, thermal_paper_width_mm: w });
    } catch { /* local width still saved */ }
  };

  const chooseWifi = async () => {
    setError(null);
    await ThermalPrinterService.disconnect().catch(() => undefined);
    setConnected(false);
    await persist({ connectionType: "WIFI" });
  };

  const chooseBt = async () => {
    setError(null);
    await persist({ connectionType: "BLUETOOTH" });
  };

  const scan = async () => {
    setError(null); setMsg(null);
    try {
      setScanning(true);
      const bonded = await listBondedPrinters();
      setDevices(bonded);
      const unsub = watchDiscoveredPrinters(mergeDevice);
      try {
        await startPrinterScan();
        await new Promise((r) => setTimeout(r, 8000));
      } finally {
        unsub();
        await stopPrinterScan();
      }
    } catch (e) {
      setError(bluetoothUserMessage(e));
    } finally {
      setScanning(false);
    }
  };

  const selectDevice = async (d: BluetoothDevice) => {
    setError(null);
    await persist({
      connectionType: "BLUETOOTH",
      printerId: d.id,
      printerName: d.name || d.id,
    });
    setConnected(false);
  };

  const connect = async () => {
    setError(null); setMsg(null);
    try {
      setBusy(true);
      await ThermalPrinterService.connect(printerId);
      setConnected(true);
      setMsg("CONNECTED");
    } catch (e) {
      setConnected(false);
      setError(bluetoothUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await ThermalPrinterService.disconnect();
    setConnected(false);
    setMsg(null);
  };

  const testPrint = async () => {
    setError(null); setMsg(null);
    try {
      setBusy(true);
      await ThermalPrinterService.testPrint();
      setConnected(true);
      setMsg("Print Successful");
    } catch (e) {
      setError(bluetoothUserMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const selectedLabel = printerName || printerId || "None";
  const status = useMemo(() => {
    if (connectionType !== "BLUETOOTH") return "Wi-Fi printer (system print)";
    if (!printerId) return "NOT CONNECTED";
    return connected ? "CONNECTED" : "NOT CONNECTED";
  }, [connectionType, printerId, connected]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="printer-back">
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>PRINTER</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>PRINTER CONNECTION</Text>
        <View style={styles.row2}>
          <Pressable
            style={[styles.chip, connectionType === "WIFI" && styles.chipOn]}
            onPress={chooseWifi}
            testID="printer-wifi"
          >
            <Text style={[styles.chipText, connectionType === "WIFI" && styles.chipTextOn]}>Wi-Fi</Text>
          </Pressable>
          <Pressable
            style={[styles.chip, connectionType === "BLUETOOTH" && styles.chipOn]}
            onPress={chooseBt}
            testID="printer-bluetooth"
          >
            <Text style={[styles.chipText, connectionType === "BLUETOOTH" && styles.chipTextOn]}>Bluetooth</Text>
          </Pressable>
        </View>

        <Text style={[styles.section, { marginTop: spacing.lg }]}>PAPER WIDTH</Text>
        <View style={styles.row2}>
          {THERMAL_PAPER_PRESETS.map((w) => (
            <Pressable
              key={w}
              style={[styles.chip, paperWidth === w && styles.chipOn]}
              onPress={() => setPaper(w)}
              testID={`printer-paper-${w}`}
            >
              <Text style={[styles.chipText, paperWidth === w && styles.chipTextOn]}>{w} mm</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Default 80 mm. Change this when you replace the printer. Layout adapts to the selected width.</Text>

        {connectionType === "WIFI" ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>
              Wi-Fi printing uses the existing system printer dialog. Farmer Patti, Vendor Bill, Cash Book and Account Ledger are unchanged.
            </Text>
          </View>
        ) : (
          <>
            {!nativeOk ? (
              <View style={styles.note}>
                <Text style={styles.noteText}>
                  Bluetooth Classic printing is included in the Android app. This development preview shows the printer settings. Pair any compatible thermal printer in Android Bluetooth settings, then select it here after the Android build.
                </Text>
              </View>
            ) : null}

            <Text style={[styles.section, { marginTop: spacing.lg }]}>SELECTED PRINTER</Text>
            <View style={styles.card}>
              <Text style={styles.k}>Printer</Text>
              <Text style={styles.v}>{selectedLabel}</Text>
              <Text style={[styles.k, { marginTop: 8 }]}>Status</Text>
              <Text style={styles.v}>{status}</Text>
            </View>

            <View style={styles.row2}>
              {connected ? (
                <Button label="DISCONNECT" onPress={disconnect} variant="secondary" testID="printer-disconnect" />
              ) : (
                <Button label={printerId ? "CONNECT" : "CONNECT"} onPress={connect} disabled={!printerId || busy} testID="printer-connect" />
              )}
            </View>
            {printerId && !connected ? (
              <Pressable onPress={connect} style={styles.linkBtn} testID="printer-reconnect">
                <Text style={styles.link}>RECONNECT</Text>
              </Pressable>
            ) : null}

            <Button label="TEST PRINT" onPress={testPrint} loading={busy} disabled={!printerId} testID="printer-test" />

            <Text style={[styles.section, { marginTop: spacing.lg }]}>BLUETOOTH DEVICES</Text>
            <Button
              label={scanning ? "SCANNING…" : "SEARCH / SCAN FOR PRINTER"}
              onPress={scan}
              variant="secondary"
              loading={scanning}
              testID="printer-scan"
            />
            <Text style={styles.hint}>
              The list includes paired Bluetooth devices. Select the thermal printer only — not earphones or speakers.
            </Text>

            {devices.map((d) => {
              const on = d.id === printerId;
              return (
                <Pressable
                  key={d.id}
                  style={[styles.devRow, on && styles.devRowOn]}
                  onPress={() => selectDevice(d)}
                  testID={`printer-device-${d.id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.devName}>{d.name || d.id}</Text>
                    <Text style={styles.devMeta}>{d.bonded ? "Paired" : "Found"} · {d.id}</Text>
                  </View>
                  {on ? <Ionicons name="checkmark" size={20} color={colors.brandPrimary} /> : null}
                </Pressable>
              );
            })}

            <Pressable
              style={styles.pairBox}
              onPress={async () => {
                try {
                  if (nativeOk) await openAndroidBluetoothSettings();
                  else if (Platform.OS === "android") await Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS");
                  else await Linking.openSettings();
                } catch {
                  Alert.alert("Bluetooth settings", "Open Android Settings → Bluetooth, pair the thermal printer, then return here and scan.");
                }
              }}
              testID="printer-pair-help"
            >
              <Ionicons name="bluetooth-outline" size={18} color={colors.onSurface} />
              <Text style={styles.pairText}>Printer not listed? Pair it in Android Bluetooth settings, then scan again.</Text>
            </Pressable>
          </>
        )}

        {error ? <Text style={styles.err}>{error}</Text> : null}
        {msg ? <Text style={styles.ok}>{msg}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    borderBottomWidth: 2, borderBottomColor: colors.borderStrong,
  },
  title: { fontSize: 22, fontWeight: "900", fontFamily: font.display, color: colors.onSurface },
  section: {
    fontSize: 11, letterSpacing: 2, color: colors.muted, textTransform: "uppercase",
    fontFamily: font.display, fontWeight: "800", marginBottom: spacing.sm,
  },
  row2: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    flex: 1, borderWidth: 2, borderColor: colors.borderStrong, paddingVertical: 12, alignItems: "center",
  },
  chipOn: { backgroundColor: colors.surfaceInverse, borderColor: colors.surfaceInverse },
  chipText: { fontFamily: font.display, fontWeight: "800", letterSpacing: 1, color: colors.onSurface },
  chipTextOn: { color: colors.onSurfaceInverse },
  hint: { fontSize: 12, color: colors.muted, marginBottom: spacing.md, fontFamily: font.display },
  note: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.md },
  noteText: { fontSize: 13, color: colors.onSurface, fontFamily: font.display, lineHeight: 18 },
  card: { borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.md },
  k: { fontSize: 10, letterSpacing: 1.2, color: colors.muted, fontWeight: "800", fontFamily: font.display },
  v: { fontSize: 16, fontWeight: "800", fontFamily: font.display, color: colors.onSurface, marginTop: 2 },
  linkBtn: { alignItems: "center", marginBottom: spacing.md },
  link: { fontWeight: "900", letterSpacing: 1, color: colors.brandPrimary, fontFamily: font.display },
  devRow: {
    flexDirection: "row", alignItems: "center", borderWidth: 2, borderColor: colors.borderStrong,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  devRowOn: { backgroundColor: colors.brandSecondary },
  devName: { fontSize: 15, fontWeight: "800", fontFamily: font.display },
  devMeta: { fontSize: 11, color: colors.muted, fontFamily: font.mono, marginTop: 2 },
  pairBox: {
    flexDirection: "row", gap: spacing.sm, alignItems: "flex-start",
    borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, marginTop: spacing.sm,
  },
  pairText: { flex: 1, fontSize: 13, fontFamily: font.display, color: colors.onSurface },
  err: { color: colors.error, backgroundColor: "#FEE2E2", borderWidth: 2, borderColor: colors.error, padding: spacing.sm, marginTop: spacing.md, fontFamily: font.display, fontWeight: "700" },
  ok: { color: colors.success, backgroundColor: "#D1FAE5", borderWidth: 2, borderColor: colors.success, padding: spacing.sm, marginTop: spacing.md, fontFamily: font.display, fontWeight: "700" },
});
