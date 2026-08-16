import { EventEmitter, requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

export type NativeBtDevice = { id: string; name: string; bonded: boolean };

type ThermalBluetoothNative = {
  isNativeAvailable(): boolean;
  isEnabled(): Promise<boolean>;
  openBluetoothSettings(): Promise<void>;
  getBondedDevices(): Promise<NativeBtDevice[]>;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(address: string): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  writeBase64(payload: string): Promise<void>;
};

function loadNative(): ThermalBluetoothNative | null {
  if (Platform.OS !== "android") return null;
  try {
    return requireNativeModule<ThermalBluetoothNative>("ThermalBluetooth");
  } catch {
    return null;
  }
}

const native = loadNative();

export function bluetoothNativeAvailable(): boolean {
  try {
    return !!native?.isNativeAvailable();
  } catch {
    return false;
  }
}

export function getBluetoothNative(): ThermalBluetoothNative | null {
  return bluetoothNativeAvailable() ? native : null;
}

export function subscribeDeviceFound(cb: (d: NativeBtDevice) => void): () => void {
  if (!native) return () => undefined;
  try {
    const emitter = new EventEmitter(native as any);
    const sub = (emitter as any).addListener("onDeviceFound", cb);
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}
