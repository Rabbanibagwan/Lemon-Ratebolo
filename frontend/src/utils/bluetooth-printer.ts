import { PermissionsAndroid, Platform } from "react-native";

import {
  bluetoothNativeAvailable,
  getBluetoothNative,
  NativeBtDevice,
  subscribeDeviceFound,
} from "../../modules/thermal-bluetooth";

export type BluetoothDevice = NativeBtDevice;

export function bluetoothHardwareAvailable(): boolean {
  return Platform.OS === "android" && bluetoothNativeAvailable();
}

export function bluetoothUserMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const lower = raw.toLowerCase();
  if (lower.includes("turned off") || lower.includes("bluetooth is off") || lower.includes("bt_off")) {
    return "Bluetooth is turned off.";
  }
  if (lower.includes("permission")) {
    return "Bluetooth permission is required to connect to the printer.";
  }
  if (lower.includes("disconnected") || lower.includes("not connected") || lower.includes("socket")) {
    return "Printer disconnected.";
  }
  if (raw && /bluetooth is turned off|permission is required|printer disconnected|printing failed/i.test(raw)) {
    return raw;
  }
  return "Printing failed. Check the printer connection and try again.";
}

async function requestBtPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const sdk = typeof Platform.Version === "number" ? Platform.Version : parseInt(String(Platform.Version), 10);
  try {
    if (sdk >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      ]);
      const connect = res[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT];
      const scan = res[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN];
      return connect === PermissionsAndroid.RESULTS.GRANTED && scan === PermissionsAndroid.RESULTS.GRANTED;
    }
    const loc = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return loc === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function ensureBluetoothReady(): Promise<void> {
  const n = getBluetoothNative();
  if (!n) {
    throw new Error("Bluetooth printing is not available in this preview. Use the Android app after it is built.");
  }
  const ok = await requestBtPermissions();
  if (!ok) throw new Error("Bluetooth permission is required to connect to the printer.");
  const on = await n.isEnabled();
  if (!on) throw new Error("Bluetooth is turned off.");
}

export async function openAndroidBluetoothSettings(): Promise<void> {
  const n = getBluetoothNative();
  if (n) {
    await n.openBluetoothSettings();
    return;
  }
}

export async function listBondedPrinters(): Promise<BluetoothDevice[]> {
  await ensureBluetoothReady();
  const n = getBluetoothNative()!;
  return n.getBondedDevices();
}

export function watchDiscoveredPrinters(cb: (d: BluetoothDevice) => void): () => void {
  return subscribeDeviceFound(cb);
}

export async function startPrinterScan(): Promise<void> {
  await ensureBluetoothReady();
  await getBluetoothNative()!.startScan();
}

export async function stopPrinterScan(): Promise<void> {
  const n = getBluetoothNative();
  if (n) await n.stopScan().catch(() => undefined);
}

export async function connectBluetoothPrinter(address: string): Promise<void> {
  await ensureBluetoothReady();
  try {
    await getBluetoothNative()!.connect(address);
  } catch (e) {
    throw new Error(bluetoothUserMessage(e));
  }
}

export async function disconnectBluetoothPrinter(): Promise<void> {
  const n = getBluetoothNative();
  if (n) await n.disconnect().catch(() => undefined);
}

export async function bluetoothPrinterConnected(): Promise<boolean> {
  const n = getBluetoothNative();
  if (!n) return false;
  try {
    return await n.isConnected();
  } catch {
    return false;
  }
}

export async function writeEscPos(bytesBase64: string): Promise<void> {
  const n = getBluetoothNative();
  if (!n) throw new Error("Bluetooth printing is not available in this preview. Use the Android app after it is built.");
  const connected = await n.isConnected();
  if (!connected) throw new Error("Printer disconnected.");
  try {
    await n.writeBase64(bytesBase64);
  } catch (e) {
    throw new Error(bluetoothUserMessage(e));
  }
}
