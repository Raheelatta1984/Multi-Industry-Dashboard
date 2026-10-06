/**
 * Demo raw files. Deliberately messy — title rows above headers, mixed date
 * formats, currency symbols inside numbers, parenthesized negatives, totals
 * rows, duplicate rows, inconsistent category spellings, blanks — exactly
 * what lands in finance inboxes every month. The pipeline has to earn its
 * keep on these.
 */
import * as XLSX from "xlsx";
import { mulberry32 } from "../sample-data";
import { downloadArrayBuffer } from "../excel";
import type { CellValue } from "./types";

export type MessySample = {
  id: string;
  label: string;
  fileName: string;
  blurb: string;
  domain: string;
  grid: CellValue[][];
};

function row(...cells: CellValue[]): CellValue[] {
  return cells;
}

// ---------------------------------------------------------------------------
// 1 — regional sales export (sales domain)
// ---------------------------------------------------------------------------

function salesGrid(): CellValue[][] {
  const rng = mulberry32(4242);
  const divisions = ["Apex Retail", "Lumen Software", "Meridian Health", "Volt Energy", "Northline Logistics"];
  const products = [
    ["Meridian POS Terminal", "POS-4400"],
    ["Lumen Analytics Suite", "LUM-2200"],
    ["CareTrack Monitor", "CRM-8100"],
    ["VoltGrid Inverter", "VLT-6500"],
    ["Northline TMS Module", "NLX-3300"],
  ];
  const regions = ["UAE", "KSA", "Singapore", "US East", "US West", "Germany", "India", "Brazil", "UK", "Middle East"];
  const channels = ["e-com", "Ecommerce", "Online", "online", "Partner", "Retail", "Wholesale"];
  const dateFormats = [
    (d: Date) => d.toISOString().slice(0, 10),
    (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`,
    (d: Date) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`,
    (d: Date) => d.toISOString().slice(0, 7),
  ];
  const reps = ["A. Rahman", "S. Okafor", "J. Silva", "M. Chen", "L. Haddad"];
  const rows: CellValue[][] = [
    row("Regional Sales Export — Q3 FY26 (raw, do not reformat)"),
    row("Order Date", "Region / Country", "Business Unit", "Sales Rep", "Product Line", "SKU", "Qty", "Unit Price ($)", "Net Sales (USD)", "Channel."),
  ];
  const out: CellValue[][] = [];
  for (let i = 0; i < 38; i++) {
    const d = new Date(Date.UTC(2026, 6 + (i % 3), 1 + (i % 27)));
    const [product, sku] = products[Math.floor(rng() * products.length)]!;
    const qty = 2 + Math.floor(rng() * 40);
    const price = [89, 149, 1200, 4300, 2200][Math.floor(rng() * 5)]!;
    const net = qty * price;
    const region = regions[Math.floor(rng() * regions.length)]!;
    const rep = reps[Math.floor(rng() * reps.length)]!;
    const channel = channels[Math.floor(rng() * channels.length)]!;
    out.push(
      row(
        dateFormats[i % dateFormats.length]!(d),
        region,
        divisions[Math.floor(rng() * divisions.length)]!,
        rep,
        product,
        rng() < 0.08 ? null : sku,
        rng() < 0.07 ? null : qty,
        `$${price.toFixed(2)}`,
        `$${net.toLocaleString("en-US")}.00`,
        channel,
      ),
    );
  }
  // Deliberate duplicates (same export run twice by mistake).
  out.push([...out[3]!], [...out[11]!]);
  // Totals row from the source system.
  out.push(row("TOTAL", null, null, null, null, null, null, null, "$1,284,500.00", null));
  return [...rows, ...out];
}

// ---------------------------------------------------------------------------
// 2 — consolidated opex (expenses domain)
// ---------------------------------------------------------------------------

function opexGrid(): CellValue[][] {
  const rng = mulberry32(777);
  const entities = ["Meridian Capital", "Apex Retail", "Lumen Software", "Meridian Works", "Harbor Stays"];
  const costCentres = ["Mktg", "Marketing", "IT", "ICT", "Finance", "Ops", "HR", "Sales", "Procurement"];
  const vendors = [
    ["Snowpeak Cloud", "Cloud & SaaS"],
    ["AdVantage Media", "Media"],
    ["Grayline Advisory", "Professional"],
    ["TransGulf Freight", "Freight"],
    ["OrbitDesk SaaS", "saas"],
    ["Meridian Facilities", "Facilities"],
    ["SkyWings Travel", "Travel"],
  ];
  const months = ["Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26"];
  const rows: CellValue[][] = [
    row("OPEX — consolidated export v2 (finance shared drive)"),
    row("Month", "Cost Centre", "Entity", "Vendor Name", "Cat.", "Spend (AED)", "Recurring?"),
  ];
  const out: CellValue[][] = [];
  for (let i = 0; i < 34; i++) {
    const [vendor, cat] = vendors[Math.floor(rng() * vendors.length)]!;
    const spend = 2500 + Math.floor(rng() * 180000);
    const negative = rng() < 0.12; // credit note — parenthesized
    out.push(
      row(
        months[i % months.length]!,
        costCentres[Math.floor(rng() * costCentres.length)]!,
        entities[Math.floor(rng() * entities.length)]!,
        vendor,
        cat,
        negative ? `(${spend.toLocaleString("en-US")})` : `AED ${spend.toLocaleString("en-US")}`,
        rng() < 0.6 ? "Y" : "N",
      ),
    );
  }
  out.push([...out[5]!]);
  out.push(row("Grand Total", null, null, null, null, "AED 3,412,880", null));
  return [...rows, ...out];
}

// ---------------------------------------------------------------------------
// 3 — inventory & COGS (turnover domain)
// ---------------------------------------------------------------------------

function inventoryGrid(): CellValue[][] {
  const rng = mulberry32(31337);
  const entities = ["Everyday Goods", "Meridian Works", "Apex Wholesale", "Northline Logistics"];
  const depts = ["Supply Chain", "Supply chain", "SCM", "Ops", "Operations"];
  const periods = ["2026-04", "May 2026", "06/2026", "Jul 2026", "2026-08"];
  const rows: CellValue[][] = [
    row("Stock & COGS by business unit — Q3 FY26"),
    row("Period", "Business Unit", "Dept", "Opening Stock", "Closing Stock", "COGS (USD)"),
  ];
  const out: CellValue[][] = [];
  for (let i = 0; i < 20; i++) {
    const open = 40000 + Math.floor(rng() * 900000);
    const close = Math.round(open * (0.82 + rng() * 0.36));
    const cogs = Math.round((open + close) / 2 * (0.25 + rng() * 0.4));
    out.push(
      row(
        periods[i % periods.length]!,
        entities[Math.floor(rng() * entities.length)]!,
        depts[Math.floor(rng() * depts.length)]!,
        open.toLocaleString("en-US"),
        close.toLocaleString("en-US"),
        cogs.toLocaleString("en-US"),
      ),
    );
  }
  return [...rows, ...out];
}

export const MESSY_SAMPLES: MessySample[] = [
  {
    id: "sales-q3",
    label: "Regional sales export",
    fileName: "regional-sales_Q3-raw.xlsx",
    blurb: "38 order lines, 4 date formats, $ inside numbers, duplicate rows, a TOTAL row, 7 spellings of 4 channels.",
    domain: "Sales",
    grid: salesGrid(),
  },
  {
    id: "opex-v2",
    label: "Consolidated opex",
    fileName: "opex-consolidated_v2.xlsx",
    blurb: "34 spend lines in AED, parenthesized credit notes, Y/N flags, 9 cost-centre spellings, messy categories.",
    domain: "Expenses",
    grid: opexGrid(),
  },
  {
    id: "inventory-q3",
    label: "Stock & COGS by unit",
    fileName: "group-inventory-cogs_Q3.xlsx",
    blurb: "20 period rows, mixed period formats, comma-separated thousands, supply-chain department variants.",
    domain: "Inventory turnover",
    grid: inventoryGrid(),
  },
];

/** Rebuild any sample as a real .xlsx the user can download and re-upload. */
export function downloadSample(sample: MessySample) {
  const ws = XLSX.utils.aoa_to_sheet(sample.grid as unknown[][]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Export");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  downloadArrayBuffer(buf, sample.fileName);
}
