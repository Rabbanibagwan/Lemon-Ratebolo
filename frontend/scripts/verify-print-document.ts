/**
 * Field-parity check: canonical print documents for example Patti + Vendor Bill.
 * Run: npx --yes tsx scripts/verify-print-document.ts
 */
import {
  buildFarmerPattiPrintDocument,
  buildVendorBillPrintDocument,
} from "../src/utils/print-document";
import type { Patti, ShopProfile, VendorBill } from "../src/api";

const profile: ShopProfile = {
  shop_name: "Test Mandi",
  address: "Market Road",
  village: "V1",
  taluk: "T1",
  district: "D1",
  state: "KA",
  mobile: "9999999999",
} as ShopProfile;

const patti = {
  id: "patti-1",
  patti_no: 7,
  farmer_name: "MMMD",
  driver_name: "BHIG",
  receiver_name: "BHIG",
  created_at: "2026-09-25T10:00:00.000Z",
  payment_factor: 1,
  total_bags: 1,
  hamali_per_bag: 10,
  hamali_total: 10,
  bhada_total: 500,
  stationery_total: 5,
  deductions_total: 515,
  farmer_gross: 45000,
  net_payable: 44485,
  qr_token: "tok",
  lots: [
    {
      lot_no: "7/1",
      lot_serial_no: 7,
      total_bags: 1,
      sales: [{ bags: 1, rate_per_bag: 45000 }],
    },
  ],
} as unknown as Patti;

const bill = {
  id: "bill-1",
  bill_code: "VB-001",
  vendor_name: "ASM",
  date: "2026-09-25",
  goods_total: 50030,
  commission_total: 10,
  hamali: 0,
  cess: 150,
  grand_total: 50190,
  paid: 0,
  balance: 50190,
  lines: [{ lot_no: "7/1", farmer_name: "MMMD", bags: 1, vendor_rate: 50030, amount: 50030 }],
} as unknown as VendorBill;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const pd = buildFarmerPattiPrintDocument(patti, profile, { paperMm: 80 });
assert(pd.type === "FARMER_PATTI", "type");
assert(pd.farmer === "MMMD", "farmer");
assert(pd.driver === "BHIG", "driver");
assert(pd.gross === 45000, "gross");
assert(pd.hamali === 10, "hamali");
assert(pd.bhada === 500, "bhada");
assert(pd.stationery === 5, "stationery");
assert(pd.deduction === 515, "deduction");
assert(pd.net_payable === 44485, "net");
assert(pd.receiver === "BHIG", "receiver");
assert(pd.lines[0].lot_no === "7/1", "lot");
assert(pd.lines[0].amount === 45000, "line amount");
assert(pd.shop_address.includes("Market Road"), "shop address");

const vd = buildVendorBillPrintDocument(bill, profile, { paperMm: 80 });
assert(vd.type === "VENDOR_BILL", "vb type");
assert(vd.vendor === "ASM", "vendor");
assert(vd.lemon_amount === 50030, "lemon");
assert(vd.commission === 10, "commission");
assert(vd.hamali === 0, "vb hamali");
assert(vd.cess === 150, "cess");
assert(vd.grand_total === 50190, "grand");
assert(vd.paid === 0, "paid");
assert(vd.balance_due === 50190, "balance");
assert(vd.lines[0].lot_no === "7/1", "vb lot");
assert(vd.lines[0].farmer_name === "MMMD", "vb farmer");

console.log("verify-print-document: PASS");
console.log(
  JSON.stringify(
    {
      patti: {
        gross: pd.gross,
        hamali: pd.hamali,
        bhada: pd.bhada,
        stationery: pd.stationery,
        deduction: pd.deduction,
        net_payable: pd.net_payable,
      },
      vendor: {
        lemon_amount: vd.lemon_amount,
        commission: vd.commission,
        cess: vd.cess,
        grand_total: vd.grand_total,
        balance_due: vd.balance_due,
      },
    },
    null,
    2,
  ),
);
