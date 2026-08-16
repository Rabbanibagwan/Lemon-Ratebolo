package expo.modules.thermalbluetooth

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.provider.Settings
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.OutputStream
import java.util.UUID

/**
 * Generic Bluetooth Classic (SPP / RFCOMM) transport for ESC/POS thermal printers.
 * No printer-brand logic — any paired SPP device can be selected by the merchant.
 */
class ThermalBluetoothModule : Module() {
  private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  private var socket: BluetoothSocket? = null
  private var output: OutputStream? = null
  private var scanning = false

  private val adapter: BluetoothAdapter?
    get() {
      val ctx = appContext.reactContext ?: return null
      val mgr = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      return mgr?.adapter ?: BluetoothAdapter.getDefaultAdapter()
    }

  private val discoveryReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != BluetoothDevice.ACTION_FOUND) return
      val device: BluetoothDevice? =
        if (Build.VERSION.SDK_INT >= 33) {
          intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }
      if (device == null) return
      val name = try { device.name } catch (_: SecurityException) { null }
      val address = try { device.address } catch (_: SecurityException) { null } ?: return
      sendEvent(
        "onDeviceFound",
        mapOf(
          "id" to address,
          "name" to (name ?: address),
          "bonded" to (device.bondState == BluetoothDevice.BOND_BONDED),
        ),
      )
    }
  }

  private fun closeSocket() {
    try { output?.close() } catch (_: Exception) {}
    try { socket?.close() } catch (_: Exception) {}
    output = null
    socket = null
  }

  override fun definition() = ModuleDefinition {
    Name("ThermalBluetooth")
    Events("onDeviceFound")

    Function("isNativeAvailable") { true }

    AsyncFunction("isEnabled") {
      adapter?.isEnabled == true
    }

    AsyncFunction("openBluetoothSettings") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val intent = Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      null
    }

    AsyncFunction("getBondedDevices") {
      val a = adapter ?: return@AsyncFunction emptyList<Map<String, Any>>()
      val bonded = try {
        a.bondedDevices ?: emptySet()
      } catch (_: SecurityException) {
        emptySet()
      }
      bonded.map { d ->
        val name = try { d.name } catch (_: SecurityException) { null }
        mapOf(
          "id" to d.address,
          "name" to (name ?: d.address),
          "bonded" to true,
        )
      }
    }

    AsyncFunction("startScan") {
      val ctx = appContext.reactContext ?: throw Exception("unavailable")
      val a = adapter ?: throw Exception("Bluetooth is turned off.")
      if (!a.isEnabled) throw Exception("Bluetooth is turned off.")
      if (scanning) return@AsyncFunction null
      val filter = IntentFilter(BluetoothDevice.ACTION_FOUND)
      if (Build.VERSION.SDK_INT >= 33) {
        ctx.registerReceiver(discoveryReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        ctx.registerReceiver(discoveryReceiver, filter)
      }
      scanning = true
      try {
        a.cancelDiscovery()
        a.startDiscovery()
      } catch (e: SecurityException) {
        scanning = false
        try { ctx.unregisterReceiver(discoveryReceiver) } catch (_: Exception) {}
        throw Exception("Bluetooth permission is required to connect to the printer.")
      }
      null
    }

    AsyncFunction("stopScan") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val a = adapter
      try { a?.cancelDiscovery() } catch (_: Exception) {}
      if (scanning) {
        try { ctx.unregisterReceiver(discoveryReceiver) } catch (_: Exception) {}
      }
      scanning = false
      null
    }

    AsyncFunction("connect") { address: String ->
      val a = adapter ?: throw Exception("Bluetooth is turned off.")
      if (!a.isEnabled) throw Exception("Bluetooth is turned off.")
      closeSocket()
      try { a.cancelDiscovery() } catch (_: Exception) {}
      val device = try {
        a.getRemoteDevice(address)
      } catch (_: Exception) {
        throw Exception("Printer disconnected.")
      }
      var sock = try {
        device.createRfcommSocketToServiceRecord(sppUuid)
      } catch (_: Exception) {
        try {
          val m = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
          m.invoke(device, 1) as BluetoothSocket
        } catch (_: Exception) {
          throw Exception("Printing failed. Check the printer connection and try again.")
        }
      }
      try {
        sock.connect()
      } catch (e: Exception) {
        try { sock.close() } catch (_: Exception) {}
        throw Exception("Printer disconnected.")
      }
      socket = sock
      output = sock.outputStream
    }

    AsyncFunction("disconnect") {
      closeSocket()
    }

    AsyncFunction("isConnected") {
      socket?.isConnected == true && output != null
    }

    AsyncFunction("writeBase64") { payload: String ->
      val out = output ?: throw Exception("Printer disconnected.")
      if (socket?.isConnected != true) throw Exception("Printer disconnected.")
      val bytes = Base64.decode(payload, Base64.DEFAULT)
      try {
        out.write(bytes)
        out.flush()
      } catch (_: Exception) {
        closeSocket()
        throw Exception("Printing failed. Check the printer connection and try again.")
      }
    }
  }
}
