/**
 * Store compliance: scope legacy Bluetooth location permission to API 30 and below.
 * Matches runtime logic in src/utils/bluetooth-printer.ts (ACCESS_FINE_LOCATION only when sdk < 31).
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const ACCESS_FINE_LOCATION = "android.permission.ACCESS_FINE_LOCATION";

function withAndroidStorePermissions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const existing = manifest["uses-permission"] || [];

    manifest["uses-permission"] = existing.filter(
      (entry) => entry.$?.["android:name"] !== ACCESS_FINE_LOCATION,
    );

    manifest["uses-permission"].push({
      $: {
        "android:name": ACCESS_FINE_LOCATION,
        "android:maxSdkVersion": "30",
      },
    });

    return config;
  });
}

module.exports = withAndroidStorePermissions;
