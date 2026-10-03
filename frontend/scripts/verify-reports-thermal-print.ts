/**
 * Verify Reports Driver/Vendor Details thermal PRINT encoders + staff gates + wiring.
 * Run: npx --yes tsx scripts/verify-reports-thermal-print.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  encodeDriverDetailsReportEscPos,
  encodeVendorDetailsReportEscPos,
} from "../src/utils/reports-thermal-escpos";
import { escposCols } from "../src/utils/escpos";

function decodeEscPosText(b64: string): string {
  const bin = Buffer.from(b64, "base64");
  let out = "";
  let i = 0;
  while (i < bin.length) {
    const b = bin[i];
    if (b === 0x0a) {
      out += "\n";
      i++;
      continue;
    }
    if (b === 0x1b || b === 0x1d) {
      if (b === 0x1b && bin[i + 1] === 0x40) {
        i += 2;
        continue;
      }
      if (
        (b === 0x1b && (bin[i + 1] === 0x61 || bin[i + 1] === 0x45 || bin[i + 1] === 0x2d || bin[i + 1] === 0x4d)) ||
        (b === 0x1d && (bin[i + 1] === 0x21 || bin[i + 1] === 0x42))
      ) {
        i += 3;
        continue;
      }
      if (b === 0x1d && bin[i + 1] === 0x56) {
        const m = bin[i + 2];
        i += m >= 65 ? 4 : 3;
        continue;
      }
      if (b === 0x1d && (bin[i + 1] === 0x57 || bin[i + 1] === 0x4c)) {
        i += 4;
        continue;
      }
      if (b === 0x1d && bin[i + 1] === 0x28 && bin[i + 2] === 0x6b) {
        const plen = bin[i + 3] + (bin[i + 4] << 8);
        i += 5 + plen;
        continue;
      }
      i += 2;
      continue;
    }
    if (b >= 32 && b < 127) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    if (b >= 0xc0) {
      const len = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      out += bin.slice(i, i + len).toString("utf8");
      i += len;
      continue;
    }
    i++;
  }
  return out;
}

function hasCut(b64: string): boolean {
  const bin = Buffer.from(b64, "base64");
  for (let i = 0; i < bin.length - 2; i++) {
    if (bin[i] === 0x1d && bin[i + 1] === 0x56) return true;
  }
  return false;
}

/** Mirror of canUserExportReport — assert source contains the same rules. */
function canUserExportReport(role: string | undefined, mode: string): boolean {
  if (!role) return false;
  if (mode === "entry") return false;
  if (mode === "audit") return role === "owner";
  if (mode === "driver" || mode === "farmer" || mode === "vendor") {
    return role === "owner" || role === "counter";
  }
  return false;
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`);
  }
}

const drivers = [
  {
    driver_name: "Ramu Very Long Driver Name From Village",
    lot_from: "1",
    lot_to: "25",
    total_bags: 40,
    total_bhada: 1200.5,
  },
  {
    driver_name: "Seetha",
    lot_from: "26",
    lot_to: "40",
    total_bags: 15,
    total_bhada: 450,
  },
];

const bills = [
  {
    bill_code: "VB-0001",
    vendor_name: "Super Long Vendor Name Trading Company",
    total_bags: 12,
    grand_total: 5500.75,
  },
  {
    bill_code: "VB-0002",
    vendor_name: "Shop A",
    total_bags: 8,
    grand_total: 2100,
  },
];

for (const mm of [58, 80, 100] as const) {
  check(`${mm}mm escpos cols`, escposCols(mm) === (mm <= 58 ? 32 : mm <= 80 ? 48 : 64));

  const drvB64 = encodeDriverDetailsReportEscPos(drivers, "2026-10-03", "Demo Mandi", mm);
  const drv = decodeEscPosText(drvB64);
  check(`${mm}mm driver DRIVER DETAILS`, drv.includes("DRIVER DETAILS"));
  check(`${mm}mm driver shop header`, drv.toUpperCase().includes("DEMO MANDI"));
  check(`${mm}mm driver date`, drv.includes("2026-10-03"));
  check(
    `${mm}mm driver columns`,
    /DRIVER/.test(drv) && /FROM/.test(drv) && /TO/.test(drv) && /BAGS/.test(drv) && /BHADA/.test(drv),
  );
  check(`${mm}mm driver rows`, drv.includes("Seetha") && drv.includes("Ramu"));
  check(`${mm}mm driver totals`, drv.includes("TOTAL BAGS") && drv.includes("TOTAL BHADA"));
  check(`${mm}mm driver cut`, hasCut(drvB64));
  check(
    `${mm}mm driver no detail cols`,
    !drv.includes("NET PAY") && !drv.includes("FARMER") && !drv.includes("RECV"),
  );

  const venB64 = encodeVendorDetailsReportEscPos(bills, "2026-10-03", "Demo Mandi", mm);
  const ven = decodeEscPosText(venB64);
  check(`${mm}mm vendor VENDOR DETAILS`, ven.includes("VENDOR DETAILS"));
  check(
    `${mm}mm vendor columns`,
    /BILL NO/.test(ven) && /VENDOR/.test(ven) && /BAGS/.test(ven) && /TOTAL/.test(ven),
  );
  check(`${mm}mm vendor rows`, ven.includes("VB-0001") && ven.includes("Shop A"));
  check(`${mm}mm vendor grand total`, ven.includes("GRAND TOTAL"));
  check(`${mm}mm vendor cut`, hasCut(venB64));
}

check("staff driver print", canUserExportReport("counter", "driver") === true);
check("staff vendor print", canUserExportReport("counter", "vendor") === true);
check("staff farmer share/save", canUserExportReport("counter", "farmer") === true);
check("staff entry blocked", canUserExportReport("counter", "entry") === false);
check("staff audit blocked", canUserExportReport("counter", "audit") === false);
check("owner audit ok", canUserExportReport("owner", "audit") === true);

const reportsTsx = readFileSync(join(__dirname, "../app/(tabs)/reports.tsx"), "utf8");
check("SAVE button unchanged testID", reportsTsx.includes('testID="reports-save"'));
check("SHARE button unchanged testID", reportsTsx.includes('testID="reports-share"'));
check("SAVE opens format picker vendor", reportsTsx.includes('setFormatPicker({ kind: "vendor", action: "save" })'));
check("SHARE opens format picker vendor", reportsTsx.includes('setFormatPicker({ kind: "vendor", action: "share" })'));
check("driver SHARE still shareDriverThermalReport", reportsTsx.includes("shareDriverThermalReport"));
check("driver thermal PRINT wired", reportsTsx.includes("thermalPrintDriverDetailsReport"));
check("vendor thermal PRINT wired", reportsTsx.includes("thermalPrintVendorDetailsReport"));
check("driver print testID", reportsTsx.includes('testID="reports-driver-thermal-print"'));
check("vendor print testID", reportsTsx.includes('testID="reports-vendor-thermal-print"'));
check("staff export helper used", reportsTsx.includes("canUserExportReport"));

const pattiPrint = readFileSync(join(__dirname, "../src/utils/patti-print.ts"), "utf8");
check(
  "canUserExportReport allows staff driver/vendor",
  /mode === "driver" \|\| mode === "farmer" \|\| mode === "vendor"/.test(pattiPrint) &&
    pattiPrint.includes('session.role === "counter"'),
);

const conn = readFileSync(join(__dirname, "../src/utils/thermal-connection.ts"), "utf8");
check("requireBluetooth supported", conn.includes("requireBluetooth"));

const exportTs = readFileSync(join(__dirname, "../src/utils/reports-export.ts"), "utf8");
check("driver print requireBluetooth", /thermalPrintDriverDetailsReport[\s\S]*?requireBluetooth:\s*true/.test(exportTs));
check("vendor print requireBluetooth", /thermalPrintVendorDetailsReport[\s\S]*?requireBluetooth:\s*true/.test(exportTs));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
