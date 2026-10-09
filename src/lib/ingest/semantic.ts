/**
 * Stage 3 — the semantic layer. Classifies the dataset into a canonical
 * domain, maps every column to a canonical field with a confidence score and
 * a human-readable reason, and coerces messy values into the warehouse's
 * controlled vocabularies (industries, departments, regions, channels,
 * currencies) using dictionary + fuzzy matching.
 *
 * In production this stage is backed by an LLM + embedding match over the
 * customer's semantic model; here it is a deterministic, auditable stand-in
 * so every decision can be inspected and overridden by a human reviewer.
 */
import { CURRENCIES, DEPARTMENTS, INDUSTRIES, type ChannelId, type CurrencyCode, type DepartmentId, type IndustryId, type RegionId } from "../domain";
import type { CellValue, CleanedTable, ColumnMapping, ColumnProfile, DomainClassification, IngestDomain } from "./types";

// ---------------------------------------------------------------------------
// Canonical field synonyms
// ---------------------------------------------------------------------------

const FIELD_SYNONYMS: Record<string, string[]> = {
  date: ["date", "sale_date", "order_date", "invoice_date", "txn_date", "transaction_date", "period", "month", "mth", "posting_date", "gl_date", "doc_date", "day", "sales_month", "reporting_period"],
  due_date: ["due", "due_date", "payment_due", "pay_by", "maturity", "due_on"],
  amount: ["amount", "amt", "value", "net_sales", "net_revenue", "gross_sales", "revenue", "sales", "sales_amount", "total", "total_amount", "spend", "expense", "cost", "amount_usd", "value_usd", "net_amount", "line_total", "extended_price", "net_value", "proceeds", "income", "payable", "payment", "base_amount", "spend_aed", "spend_sar", "net_sales_usd"],
  units: ["qty", "quantity", "units", "unit_count", "volume", "pieces", "pcs", "count", "boxes", "cartons"],
  unit_price: ["unit_price", "unit_cost", "price", "rate", "asp", "avg_price", "price_per_unit", "pp", "list_price"],
  sku: ["sku", "item", "item_code", "product_code", "product_id", "material", "part_number", "sku_code", "article"],
  product: ["product", "product_name", "product_line", "item_name", "offering"],
  industry: ["industry", "business_unit", "bu", "division", "entity", "company", "segment", "company_name", "subsidiary", "legal_entity", "group_company", "org", "vertical", "brand", "entity_name"],
  department: ["department", "dept", "cost_center", "cost_centre", "function", "team", "department_name", "cc", "function_area"],
  region: ["region", "country", "geo", "geography", "territory", "market", "area", "zone", "location", "region_country", "country_region", "market_region"],
  channel: ["channel", "sales_channel", "route_to_market", "source", "medium"],
  currency: ["currency", "ccy", "curr", "currency_code", "fx", "money"],
  vendor: ["vendor", "vendor_name", "supplier", "supplier_name", "payee", "merchant", "counterparty", "provider"],
  category: ["category", "cat", "expense_category", "expense_type", "cost_category", "gl_account", "account", "cost_type", "spend_category", "cost_center_name"],
  recurring: ["recurring", "recurring_flag", "is_recurring", "repeat", "subscription"],
  status: ["status", "state", "asset_status", "license_status"],
  seats: ["seats", "licenses", "users", "subscriptions", "entitlements", "user_count"],
  cycle: ["cycle", "billing_cycle", "term", "frequency", "payment_terms"],
  name: ["name", "asset_name", "license_name", "software", "application", "title", "item_name"],
  acquired: ["acquired", "acquisition_date", "purchase_date", "in_service_date", "capitalized"],
  cost: ["cost", "purchase_cost", "capex", "acquisition_cost", "original_cost"],
  book_value: ["book_value", "nbv", "net_book_value", "carrying_value", "residual_value"],
  start: ["start", "start_date", "effective_from", "valid_from"],
  end: ["end", "end_date", "expiry", "expiry_date", "valid_to", "renewal", "renewal_date"],
  expected_units: ["forecast_units", "expected_units", "projected_units", "fcst_qty"],
  expected_amount: ["forecast_amount", "expected_amount", "projected_revenue", "fcst_sales"],
  description: ["description", "details", "memo", "notes", "narration", "particulars", "purpose"],
  type: ["type", "payment_type", "commitment_type"],
  inventory_start: ["opening_stock", "opening_inventory", "inventory_start", "begin_inventory", "opening_balance", "start_stock", "opening"],
  inventory_end: ["closing_stock", "closing_inventory", "inventory_end", "end_inventory", "closing_balance", "end_stock", "closing"],
  cogs: ["cogs", "cost_of_goods_sold", "cost_of_sales", "cos"],
  headcount: ["headcount", "hc", "employees", "staff", "fte", "worker_count"],
};

/** Columns we recognize but deliberately keep out of the model. */
const IGNORED_SYNONYMS = ["sales_rep", "rep", "salesperson", "owner", "prepared_by", "comment", "comments", "row_id", "serial", "sr_no", "s_no", "line_no", "reference", "ref", "batch", "audit_user", "entered_by"];

const DOMAIN_KEYWORDS: Record<IngestDomain, string[]> = {
  revenue: ["revenue", "net_sales", "income", "proceeds", "gross", "amount", "billing"],
  expenses: ["expense", "spend", "cost", "vendor", "payable", "opex", "gl_account", "account", "budget", "supplier"],
  sales: ["qty", "quantity", "units", "unit_price", "sku", "asp", "price", "cartons"],
  assets: ["asset", "book_value", "nbv", "acquired", "capex", "depreciation", "in_service", "asset_class"],
  licenses: ["license", "seats", "subscription", "software", "saas", "renewal", "entitlement", "application"],
  upcoming: ["due", "payment", "invoice", "payable", "upcoming", "commitment", "scheduled", "maturity"],
  turnover: ["inventory", "stock", "cogs", "cost_of_goods", "opening", "closing", "turns"],
};

const DOMAIN_FIELDS: Record<IngestDomain, { required: string[]; optional: string[] }> = {
  revenue: { required: ["date", "amount"], optional: ["industry", "department", "product", "channel", "region", "currency", "sku"] },
  expenses: { required: ["date", "amount"], optional: ["industry", "department", "category", "vendor", "currency", "recurring"] },
  sales: { required: ["date", "units"], optional: ["industry", "department", "sku", "product", "unit_price", "amount", "currency", "region", "channel"] },
  assets: { required: ["name"], optional: ["industry", "department", "category", "acquired", "cost", "book_value", "currency", "status"] },
  licenses: { required: ["name"], optional: ["vendor", "industry", "department", "seats", "unit_price", "currency", "start", "end", "cycle"] },
  upcoming: { required: ["due_date", "amount"], optional: ["industry", "department", "description", "currency", "type", "status"] },
  turnover: { required: ["period", "inventory_end"], optional: ["industry", "department", "inventory_start", "cogs", "currency"] },
};

// ---------------------------------------------------------------------------
// Controlled vocabulary coercion
// ---------------------------------------------------------------------------

const CCY_SET = new Set<string>(CURRENCIES.map((c) => c.code));

const REGION_MAP: Record<string, RegionId> = {
  amer: "AMER", us: "AMER", usa: "AMER", "u s": "AMER", "u s a": "AMER", "united states": "AMER", "united states of america": "AMER", canada: "AMER", na: "AMER", "north america": "AMER", mexico: "AMER", americas: "AMER",
  "us east": "AMER", "us west": "AMER", "us central": "AMER", "us northeast": "AMER", "us southeast": "AMER", "us midwest": "AMER", "us northwest": "AMER", "us southwest": "AMER",
  "usa east": "AMER", "usa west": "AMER", "east us": "AMER", "west us": "AMER", "us east coast": "AMER", "us west coast": "AMER",
  emea: "EMEA", europe: "EMEA", uk: "EMEA", "united kingdom": "EMEA", germany: "EMEA", france: "EMEA", uae: "EMEA", dubai: "EMEA", "saudi arabia": "EMEA", ksa: "EMEA", "south africa": "EMEA", "middle east": "EMEA", me: "EMEA", mea: "EMEA", turkey: "EMEA", netherlands: "EMEA",
  qatar: "EMEA", kuwait: "EMEA", oman: "EMEA", bahrain: "EMEA", egypt: "EMEA", africa: "EMEA", nigeria: "EMEA", kenya: "EMEA", spain: "EMEA", italy: "EMEA", ireland: "EMEA", switzerland: "EMEA", belgium: "EMEA", poland: "EMEA", sweden: "EMEA",
  apac: "APAC", asia: "APAC", "asia pacific": "APAC", singapore: "APAC", india: "APAC", japan: "APAC", china: "APAC", australia: "APAC", nz: "APAC", "hong kong": "APAC", apj: "APAC",
  "south korea": "APAC", korea: "APAC", malaysia: "APAC", indonesia: "APAC", thailand: "APAC", philippines: "APAC", vietnam: "APAC", "new zealand": "APAC", pakistan: "APAC", bangladesh: "APAC",
  latam: "LATAM", brazil: "LATAM", "latin america": "LATAM", argentina: "LATAM", chile: "LATAM", colombia: "LATAM", peru: "LATAM", uruguay: "LATAM",
};

/** Words that clearly mean the United States, e.g. "US East", "U.S. West", "USA - Texas". */
const US_TOKEN = /(^|[^a-z])(us|usa|u\.s\.a?\.?|united states)([^a-z]|$)/;

const CHANNEL_MAP: Record<string, ChannelId> = {
  direct: "Direct", retail: "Direct", store: "Direct", stores: "Direct", "in-store": "Direct", b2b: "Direct",
  online: "Online", ecommerce: "Online", "e-commerce": "Online", "e com": "Online", ecom: "Online", web: "Online", digital: "Online", dtc: "Online",
  partner: "Partner", partners: "Partner", reseller: "Partner", resellers: "Partner", agency: "Partner", affiliates: "Partner", marketplace: "Partner",
  wholesale: "Wholesale", distributor: "Wholesale", distributors: "Wholesale", "bulk": "Wholesale", trade: "Wholesale",
};

const INDUSTRY_MAP: Record<string, IndustryId> = {};
for (const ind of INDUSTRIES) {
  INDUSTRY_MAP[ind.id] = ind.id;
  INDUSTRY_MAP[ind.label.toLowerCase()] = ind.id;
  INDUSTRY_MAP[ind.division.toLowerCase()] = ind.id;
  INDUSTRY_MAP[ind.short.toLowerCase()] = ind.id;
}
Object.assign(INDUSTRY_MAP, {
  fmcg: "cpg", "consumer goods": "cpg", "consumer packaged goods": "cpg", grocery: "retail", "food retail": "retail",
  "private equity": "financial", "bank": "financial", banking: "financial", insurance: "financial", "asset management": "financial",
  pharma: "healthcare", pharmaceutical: "healthcare", hospitals: "healthcare", clinic: "healthcare",
  hotels: "hospitality", resort: "hospitality", travel: "hospitality",
  transport: "logistics", shipping: "logistics", freight: "logistics", "3pl": "logistics",
  software: "technology", saas: "technology", it: "technology", tech: "technology",
  "oil gas": "energy", utilities: "energy", power: "energy", renewables: "energy",
  schools: "education", university: "education", training: "education",
  property: "realestate", "real estate": "realestate", construction: "realestate",
  factory: "manufacturing", plants: "manufacturing", industrial: "manufacturing",
  distribution: "wholesale", "cash carry": "wholesale",
});

const DEPARTMENT_MAP: Record<string, DepartmentId> = {};
for (const d of DEPARTMENTS) {
  DEPARTMENT_MAP[d.id] = d.id;
  DEPARTMENT_MAP[d.label.toLowerCase()] = d.id;
  DEPARTMENT_MAP[d.board.toLowerCase()] = d.id;
}
Object.assign(DEPARTMENT_MAP, {
  hr: "hrcost", "human resources": "hrcost", people: "hrcost", "people ops": "hrcost", payroll: "hrcost",
  it: "licenses", ict: "licenses", "it licenses": "licenses", technology: "licenses",
  fin: "finance", accounts: "finance", accounting: "finance", fp_a: "finance",
  mktg: "marketing", growth: "marketing", brand: "marketing",
  ops: "operations", operation: "operations", coo: "operations",
  scm: "supply", "supply chain": "supply", planning: "supply", logistics_dept: "supply",
  sales_dept: "sales", revenue_dept: "sales", commercial: "sales",
  procurement_dept: "procurement", purchasing: "procurement", sourcing: "procurement",
  treasury_dept: "treasury", cash: "treasury",
  "front line": "floor", store_ops: "floor", branch: "floor",
  exec: "executive", "md office": "executive", ceo: "executive", leadership: "executive",
  facilities: "assets", maintenance: "assets", engineering: "assets",
});

function bigrams(s: string): Set<string> {
  const t = s.replace(/[^a-z0-9 ]/g, "").trim();
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/** Dice coefficient over character bigrams — 0..1 string similarity. */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const g of x) if (y.has(g)) shared++;
  return (2 * shared) / (x.size + y.size);
}

export type CoerceResult<T> = { value: T | null; score: number; matched?: string };

function coerceFromMap<T>(raw: string, map: Record<string, T>): CoerceResult<T> {
  const key = raw.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  if (map[key] !== undefined) return { value: map[key], score: 1, matched: key };
  let best: { value: T; score: number; matched: string } | null = null;
  for (const [k, v] of Object.entries(map)) {
    const score = similarity(key, k);
    if (score > 0.72 && (!best || score > best.score)) best = { value: v, score, matched: k };
  }
  if (best) return { value: best.value, score: best.score, matched: best.matched };
  return { value: null, score: 0 };
}

export function coerceRegion(v: CellValue): CoerceResult<RegionId> {
  if (typeof v !== "string") return { value: null, score: 0 };
  const mapped = coerceFromMap(v, REGION_MAP);
  if (mapped.value) return mapped;
  // Unknown "US …" variants are still the United States, never the EMEA default.
  if (US_TOKEN.test(v.trim().toLowerCase())) return { value: "AMER", score: 0.9, matched: "us" };
  return mapped;
}
export function coerceChannel(v: CellValue): CoerceResult<ChannelId> {
  if (typeof v !== "string") return { value: null, score: 0 };
  return coerceFromMap(v, CHANNEL_MAP);
}
export function coerceIndustry(v: CellValue): CoerceResult<IndustryId> {
  if (typeof v !== "string") return { value: null, score: 0 };
  return coerceFromMap(v, INDUSTRY_MAP);
}
export function coerceDepartment(v: CellValue): CoerceResult<DepartmentId> {
  if (typeof v !== "string") return { value: null, score: 0 };
  return coerceFromMap(v, DEPARTMENT_MAP);
}
export function coerceCurrency(v: CellValue): CoerceResult<CurrencyCode> {
  if (typeof v !== "string") return { value: null, score: 0 };
  const up = v.trim().toUpperCase();
  if (CCY_SET.has(up as CurrencyCode)) return { value: up as CurrencyCode, score: 1 };
  return { value: null, score: 0 };
}

// ---------------------------------------------------------------------------
// Domain classification
// ---------------------------------------------------------------------------

export function classifyDomain(table: CleanedTable): DomainClassification {
  const scores = new Map<IngestDomain, { score: number; reasons: string[] }>();
  for (const h of table.headers) {
    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as Array<[IngestDomain, string[]]>) {
      for (const kw of keywords) {
        if (h === kw || h.includes(kw)) {
          const entry = scores.get(domain) ?? { score: 0, reasons: [] };
          entry.score += h === kw ? 2 : 1;
          entry.reasons.push(`“${h}” → ${kw}`);
          scores.set(domain, entry);
          break;
        }
      }
    }
  }
  if (!scores.size) return { domain: null, confidence: 0, reasons: ["No domain signals found — manual mapping required"], runnerUp: null };
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [topId, top] = ranked[0]!;
  const runnerUp = ranked[1]?.[0] ?? null;
  const runnerScore = ranked[1]?.[1].score ?? 0;
  const confidence = Math.min(0.98, top.score / (top.score + runnerScore + 1));
  return {
    domain: topId,
    confidence,
    reasons: top.reasons.slice(0, 6),
    runnerUp,
  };
}

// ---------------------------------------------------------------------------
// Column → canonical field mapping
// ---------------------------------------------------------------------------

function valuePatternTarget(col: ColumnProfile, values: CellValue[]): string | null {
  const sample = values.filter((v) => v !== null).slice(0, 60);
  if (!sample.length) return null;
  const str = sample.filter((v): v is string => typeof v === "string");
  const nonNull = sample.length;
  if (str.length >= nonNull * 0.8) {
    if (str.every((v) => CCY_SET.has(v.trim().toUpperCase()))) return "currency";
    if (str.every((v) => coerceRegion(v).value !== null)) return "region";
    if (str.every((v) => coerceChannel(v).value !== null)) return "channel";
    if (str.every((v) => coerceIndustry(v).value !== null)) return "industry";
    if (str.every((v) => coerceDepartment(v).value !== null)) return "department";
  }
  return null;
}

export function mapColumns(
  table: CleanedTable,
  profile: ColumnProfile[],
  domain: IngestDomain | null,
): ColumnMapping[] {
  // Without a target model there is no field list to map onto, so do not guess.
  if (!domain) {
    return table.headers.map((header) => ({
      column: header,
      target: null,
      confidence: 0,
      method: "none" as const,
      reason: "choose a target model to map this column",
      locked: false,
    }));
  }
  const fields = DOMAIN_FIELDS[domain];
  // When the domain is known, only its own canonical fields are legal targets.
  const allowed = fields ? new Set<string>([...fields.required, ...fields.optional]) : null;
  const mappings: ColumnMapping[] = table.headers.map((header, index) => {
    const col = profile[index];
    const values = table.rows.map((r) => r[index] ?? null);

    // 1 — exact canonical field name.
    if (fields && (fields.required.includes(header) || fields.optional.includes(header))) {
      return { column: header, target: header, confidence: 0.98, method: "exact" as const, reason: "exact canonical field name", locked: false };
    }

    // 1b — recognized descriptive metadata: keep out of the model.
    if (IGNORED_SYNONYMS.some((s) => header === s)) {
      return { column: header, target: null, confidence: 0.9, method: "none" as const, reason: "recognized as descriptive metadata — excluded from the model", locked: false };
    }

    // 2 — synonym dictionary (restricted to the domain's fields).
    let bestSyn: { field: string; syn: string } | null = null;
    for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
      if (allowed && !allowed.has(field)) continue;
      for (const syn of syns) {
        if (header === syn) {
          bestSyn = { field, syn };
          break;
        }
      }
      if (bestSyn) break;
    }
    if (bestSyn) {
      return { column: header, target: bestSyn.field, confidence: 0.92, method: "synonym" as const, reason: `“${bestSyn.syn}” is a known label for ${bestSyn.field}`, locked: false };
    }

    // 3 — substring / fuzzy synonym match.
    let bestPartial: { field: string; syn: string; score: number } | null = null;
    for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
      if (allowed && !allowed.has(field)) continue;
      for (const syn of syns) {
        if (syn.length < 4) continue;
        if (header.includes(syn)) {
          const score = syn.length / header.length;
          if (!bestPartial || score > bestPartial.score) bestPartial = { field, syn, score };
        }
      }
    }
    if (bestPartial && bestPartial.score >= 0.45) {
      return {
        column: header,
        target: bestPartial.field,
        confidence: 0.78,
        method: "synonym" as const,
        reason: `“${bestPartial.syn}” inside “${header}”`,
        locked: false,
      };
    }

    // 4 — value-shape evidence.
    const pattern = col ? valuePatternTarget(col, values) : null;
    if (pattern && (!allowed || allowed.has(pattern))) {
      return {
        column: header,
        target: pattern,
        confidence: 0.75,
        method: "value_pattern" as const,
        reason: `every value parses as ${pattern}`,
        locked: false,
      };
    }

    // 5 — no signal.
    return { column: header, target: null, confidence: 0, method: "none" as const, reason: "no signal — map manually or exclude", locked: false };
  });

  // 6 — required-field fallbacks for the classified domain.
  if (fields) {
    for (const req of fields.required) {
      const already = mappings.some((m) => m.target === req);
      if (already) continue;
      const candidates = mappings
        .map((m, i) => ({ m, col: profile[i], i }))
        .filter(({ m, col }) => m.target === null && col !== undefined);
      if (req === "amount" || req === "cost" || req === "book_value" || req === "cogs" || req === "payroll") {
        const numeric = candidates.filter(({ col }) => col.type === "currency" || col.type === "number" || col.type === "percent");
        if (numeric.length === 1) {
          mappings[numeric[0].i] = {
            column: numeric[0].m.column,
            target: req,
            confidence: 0.55,
            method: "fallback",
            reason: "only numeric column left — mapped to the required measure",
            locked: false,
          };
        }
      }
      if (req === "date" || req === "due_date" || req === "period") {
        const dates = candidates.filter(({ col }) => col.type === "date");
        if (dates.length === 1) {
          mappings[dates[0].i] = {
            column: dates[0].m.column,
            target: req,
            confidence: 0.6,
            method: "fallback",
            reason: "only date-typed column — mapped to the required period",
            locked: false,
          };
        }
      }
      if (req === "units" || req === "seats" || req === "headcount") {
        const ints = candidates.filter(({ col }) => col.type === "number" && Number.isInteger(col.min ?? 0) && Number.isInteger(col.max ?? 0) && (col.min ?? 0) >= 0);
        if (ints.length === 1) {
          mappings[ints[0].i] = {
            column: ints[0].m.column,
            target: req,
            confidence: 0.55,
            method: "fallback",
            reason: "only integer-count column — mapped to the required count",
            locked: false,
          };
        }
      }
      if (req === "name") {
        const texts = candidates.filter(({ col }) => col.type === "id" || col.type === "text");
        if (texts.length >= 1 && candidates.length === texts.length) {
          const first = texts[0]!;
          mappings[first.i] = {
            column: first.m.column,
            target: "name",
            confidence: 0.5,
            method: "fallback",
            reason: "first unmapped descriptive column — mapped to name",
            locked: false,
          };
        }
      }
    }
  }

  return mappings;
}

export const DOMAIN_FIELD_LIST = DOMAIN_FIELDS;
export const FIELD_LABELS: Record<string, string> = {
  date: "Date", due_date: "Due date", period: "Period", amount: "Amount", units: "Units",
  unit_price: "Unit price", sku: "SKU", product: "Product", industry: "Entity / industry",
  department: "Department", region: "Region", channel: "Channel", currency: "Currency",
  vendor: "Vendor", category: "Category", recurring: "Recurring", status: "Status",
  seats: "Seats", cycle: "Billing cycle", name: "Name", acquired: "Acquired", cost: "Cost",
  book_value: "Book value", start: "Start", end: "End", expected_units: "Expected units",
  expected_amount: "Expected amount", description: "Description", type: "Type",
  inventory_start: "Opening stock", inventory_end: "Closing stock", cogs: "COGS", headcount: "Headcount",
};
