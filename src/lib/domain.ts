export const INDUSTRIES = [
  { id: "retail", label: "Retail", short: "Retail", division: "Apex Retail" },
  { id: "wholesale", label: "Wholesale", short: "Wholesale", division: "Apex Wholesale" },
  { id: "manufacturing", label: "Manufacturing", short: "Mfg", division: "Meridian Works" },
  { id: "healthcare", label: "Healthcare", short: "Health", division: "Meridian Health" },
  { id: "hospitality", label: "Hospitality", short: "Hospitality", division: "Harbor Stays" },
  { id: "logistics", label: "Logistics", short: "Logistics", division: "Northline Logistics" },
  { id: "financial", label: "Financial Services", short: "Finance", division: "Meridian Capital" },
  { id: "technology", label: "Technology", short: "Tech", division: "Lumen Software" },
  { id: "energy", label: "Energy", short: "Energy", division: "Volt Energy" },
  { id: "education", label: "Education", short: "Education", division: "Meridian Academy" },
  { id: "realestate", label: "Real Estate", short: "Property", division: "Parcel & Place" },
  { id: "cpg", label: "Consumer Goods", short: "CPG", division: "Everyday Goods" },
] as const;

export type IndustryId = (typeof INDUSTRIES)[number]["id"];

export const DEPARTMENTS = [
  {
    id: "executive",
    label: "Executive",
    board: "Command",
    ownerTitle: "Managing Director",
  },
  {
    id: "finance",
    label: "Finance",
    board: "P&L and Expenditure",
    ownerTitle: "Finance Controller",
  },
  {
    id: "sales",
    label: "Sales",
    board: "Revenue Pulse",
    ownerTitle: "VP Sales",
  },
  {
    id: "marketing",
    label: "Marketing",
    board: "Growth Spend",
    ownerTitle: "CMO Office",
  },
  {
    id: "operations",
    label: "Operations",
    board: "Run Rate",
    ownerTitle: "COO Office",
  },
  {
    id: "procurement",
    label: "Procurement",
    board: "Vendor Spend",
    ownerTitle: "Head of Procurement",
  },
  {
    id: "assets",
    label: "Assets",
    board: "Register",
    ownerTitle: "Asset Controller",
  },
  {
    id: "licenses",
    label: "IT and Licenses",
    board: "License Cost",
    ownerTitle: "IT Finance",
  },
  {
    id: "treasury",
    label: "Treasury",
    board: "FX and Cash",
    ownerTitle: "Treasurer",
  },
  {
    id: "supply",
    label: "Supply Chain",
    board: "Demand Planning",
    ownerTitle: "Demand Planner",
  },
  {
    id: "hrcost",
    label: "People Cost",
    board: "Workforce Spend",
    ownerTitle: "People Finance",
  },
  {
    id: "floor",
    label: "Frontline",
    board: "Trading Floor",
    ownerTitle: "General Manager",
  },
] as const;

export type DepartmentId = (typeof DEPARTMENTS)[number]["id"];

export const CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "Pound Sterling", symbol: "£" },
  { code: "JPY", name: "Yen", symbol: "¥" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { code: "CNY", name: "Yuan", symbol: "¥" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
  { code: "AED", name: "UAE Dirham", symbol: "AED" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$" },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export const FX_TO_USD: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 1.087,
  GBP: 1.273,
  JPY: 0.00672,
  AUD: 0.661,
  CAD: 0.728,
  CHF: 1.124,
  CNY: 0.139,
  INR: 0.0119,
  SGD: 0.742,
  AED: 0.272,
  BRL: 0.181,
};

export const REGIONS = ["AMER", "EMEA", "APAC", "LATAM"] as const;
export type RegionId = (typeof REGIONS)[number];

export const CHANNELS = ["Direct", "Online", "Partner", "Wholesale"] as const;
export type ChannelId = (typeof CHANNELS)[number];

export const EXPENSE_CATEGORIES = [
  "Payroll",
  "Cloud and SaaS",
  "Facilities",
  "Media",
  "Freight",
  "Travel",
  "Professional",
  "Utilities",
  "Maintenance",
  "Insurance",
] as const;

export const ASSET_CATEGORIES = [
  "Property",
  "Plant",
  "Fleet",
  "IT Hardware",
  "Fixtures",
  "Medical",
  "Energy",
] as const;

export const LICENSE_VENDORS = [
  "Salesforce",
  "Microsoft",
  "SAP",
  "Adobe",
  "ServiceNow",
  "Atlassian",
  "Oracle",
  "AWS",
  "Google Cloud",
  "Workday",
] as const;

/** January-first seasonal index. */
export const SEASONALITY: Record<IndustryId, number[]> = {
  retail: [0.82, 0.78, 0.88, 0.92, 0.98, 0.95, 0.9, 0.93, 0.97, 1.05, 1.28, 1.55],
  wholesale: [0.9, 0.88, 0.94, 0.98, 1.02, 1.04, 0.96, 0.98, 1.06, 1.1, 1.12, 1.02],
  manufacturing: [0.92, 0.94, 1.02, 1.06, 1.08, 1.04, 0.9, 0.88, 1.04, 1.08, 1.02, 0.96],
  healthcare: [1.08, 1.04, 1.02, 0.98, 0.96, 0.94, 0.92, 0.94, 0.98, 1.02, 1.04, 1.08],
  hospitality: [0.78, 0.8, 0.92, 1.04, 1.12, 1.28, 1.35, 1.3, 1.08, 0.96, 0.88, 1.18],
  logistics: [0.88, 0.9, 0.98, 1.02, 1.06, 1.08, 1.04, 1.02, 1.1, 1.16, 1.22, 1.14],
  financial: [1.06, 0.98, 1.02, 1.04, 1.0, 1.02, 0.96, 0.94, 1.04, 1.06, 1.08, 1.12],
  technology: [0.94, 0.96, 1.02, 1.04, 1.06, 1.08, 1.04, 1.02, 1.08, 1.1, 1.12, 1.18],
  energy: [1.22, 1.18, 1.06, 0.92, 0.84, 0.8, 0.82, 0.84, 0.9, 1.02, 1.14, 1.26],
  education: [1.12, 1.08, 1.02, 0.88, 0.72, 0.58, 0.52, 1.18, 1.28, 1.16, 1.08, 0.96],
  realestate: [0.9, 0.92, 1.04, 1.1, 1.12, 1.08, 1.04, 1.02, 1.06, 1.08, 0.98, 0.94],
  cpg: [0.86, 0.84, 0.94, 0.98, 1.02, 1.06, 1.08, 1.04, 1.0, 1.06, 1.16, 1.22],
};

export const BASE_MONTHLY_REVENUE: Record<IndustryId, number> = {
  retail: 4_200_000,
  wholesale: 6_100_000,
  manufacturing: 5_400_000,
  healthcare: 3_800_000,
  hospitality: 2_900_000,
  logistics: 3_200_000,
  financial: 4_800_000,
  technology: 5_900_000,
  energy: 7_200_000,
  education: 1_800_000,
  realestate: 2_400_000,
  cpg: 4_500_000,
};

export const PRODUCTS: Record<IndustryId, { sku: string; name: string; price: number }[]> = {
  retail: [
    { sku: "RTL-110", name: "Meridian Tee", price: 48 },
    { sku: "RTL-204", name: "North Parka", price: 220 },
    { sku: "RTL-318", name: "Trail Sneaker", price: 128 },
    { sku: "RTL-441", name: "Studio Bag", price: 96 },
    { sku: "RTL-512", name: "Harbor Scarf", price: 54 },
    { sku: "RTL-670", name: "Apex Denim", price: 118 },
    { sku: "RTL-808", name: "Lumen Watch", price: 340 },
    { sku: "RTL-901", name: "Floor Cap", price: 32 },
  ],
  wholesale: [
    { sku: "WHS-12", name: "Case Pack A", price: 86 },
    { sku: "WHS-18", name: "Case Pack B", price: 112 },
    { sku: "WHS-24", name: "Pallet Mix", price: 640 },
    { sku: "WHS-31", name: "Private Label", price: 44 },
    { sku: "WHS-40", name: "Club Bundle", price: 210 },
    { sku: "WHS-55", name: "Foodservice Crate", price: 175 },
    { sku: "WHS-62", name: "Impulse Tray", price: 28 },
    { sku: "WHS-77", name: "Seasonal Crate", price: 260 },
  ],
  manufacturing: [
    { sku: "MFG-A1", name: "Precision Housing", price: 420 },
    { sku: "MFG-B4", name: "Drive Assembly", price: 890 },
    { sku: "MFG-C2", name: "Seal Kit", price: 64 },
    { sku: "MFG-D9", name: "Control Board", price: 310 },
    { sku: "MFG-E3", name: "Frame Weldment", price: 540 },
    { sku: "MFG-F7", name: "Bearing Set", price: 96 },
    { sku: "MFG-G5", name: "Motor 2.2kW", price: 760 },
    { sku: "MFG-H8", name: "Sensor Pack", price: 145 },
  ],
  healthcare: [
    { sku: "HLT-OP", name: "Outpatient Visit", price: 280 },
    { sku: "HLT-DX", name: "Diagnostics Panel", price: 190 },
    { sku: "HLT-RX", name: "Therapy Course", price: 640 },
    { sku: "HLT-IM", name: "Imaging Slot", price: 420 },
    { sku: "HLT-DC", name: "Day Case", price: 2100 },
    { sku: "HLT-PT", name: "Physio Block", price: 160 },
    { sku: "HLT-LB", name: "Lab Panel", price: 88 },
    { sku: "HLT-VC", name: "Vaccine Clinic", price: 54 },
  ],
  hospitality: [
    { sku: "HSP-RN", name: "Room Night", price: 186 },
    { sku: "HSP-ST", name: "Suite Night", price: 340 },
    { sku: "HSP-FB", name: "F&B Cover", price: 48 },
    { sku: "HSP-EV", name: "Event Package", price: 2400 },
    { sku: "HSP-SP", name: "Spa Circuit", price: 120 },
    { sku: "HSP-PK", name: "Parking Day", price: 28 },
    { sku: "HSP-MB", name: "Membership", price: 90 },
    { sku: "HSP-CT", name: "Catering Tray", price: 75 },
  ],
  logistics: [
    { sku: "LOG-FTL", name: "Full Truckload", price: 1850 },
    { sku: "LOG-LTL", name: "Less-than-load", price: 420 },
    { sku: "LOG-PAR", name: "Parcel Lane", price: 18 },
    { sku: "LOG-AIR", name: "Air Freight kg", price: 6.4 },
    { sku: "LOG-SEA", name: "Ocean TEU", price: 2100 },
    { sku: "LOG-WH", name: "Warehouse Pallet", price: 22 },
    { sku: "LOG-XM", name: "Last Mile Stop", price: 9.5 },
    { sku: "LOG-CS", name: "Cross Dock", price: 55 },
  ],
  financial: [
    { sku: "FIN-AM", name: "AUM Mandate bp", price: 42 },
    { sku: "FIN-LN", name: "Loan Origination", price: 1200 },
    { sku: "FIN-CD", name: "Card Interchange", price: 18 },
    { sku: "FIN-TR", name: "Treasury Desk", price: 260 },
    { sku: "FIN-IN", name: "Insurance Binder", price: 480 },
    { sku: "FIN-AD", name: "Advisory Day", price: 3200 },
    { sku: "FIN-FX", name: "FX Spread Lot", price: 75 },
    { sku: "FIN-CS", name: "Custody Account", price: 35 },
  ],
  technology: [
    { sku: "TEC-SE", name: "Seat Enterprise", price: 68 },
    { sku: "TEC-SB", name: "Seat Business", price: 32 },
    { sku: "TEC-API", name: "API Million", price: 14 },
    { sku: "TEC-ST", name: "Storage TB", price: 22 },
    { sku: "TEC-PS", name: "Premium Support", price: 1800 },
    { sku: "TEC-IM", name: "Implementation", price: 12000 },
    { sku: "TEC-AI", name: "Inference Pack", price: 240 },
    { sku: "TEC-ED", name: "Education Seat", price: 9 },
  ],
  energy: [
    { sku: "NRG-MWH", name: "MWh Retail", price: 92 },
    { sku: "NRG-GAS", name: "Therm Bundle", price: 18 },
    { sku: "NRG-PP", name: "PPA Block", price: 6400 },
    { sku: "NRG-EV", name: "Charge Session", price: 11 },
    { sku: "NRG-GR", name: "Grid Services", price: 420 },
    { sku: "NRG-SOL", name: "Solar kW", price: 1.4 },
    { sku: "NRG-ST", name: "Storage Cycle", price: 28 },
    { sku: "NRG-OM", name: "O&M Contract", price: 2100 },
  ],
  education: [
    { sku: "EDU-TU", name: "Tuition Term", price: 4200 },
    { sku: "EDU-HO", name: "Housing Term", price: 1800 },
    { sku: "EDU-ON", name: "Online Course", price: 240 },
    { sku: "EDU-LB", name: "Lab Fee", price: 180 },
    { sku: "EDU-CF", name: "Conference", price: 640 },
    { sku: "EDU-RS", name: "Research Grant Day", price: 1100 },
    { sku: "EDU-CT", name: "Catering", price: 16 },
    { sku: "EDU-BK", name: "Bookstore", price: 42 },
  ],
  realestate: [
    { sku: "REA-LS", name: "Lease Month", price: 3200 },
    { sku: "REA-MG", name: "Management Fee", price: 420 },
    { sku: "REA-PK", name: "Parking Stall", price: 85 },
    { sku: "REA-FT", name: "Fit-out Recovery", price: 1800 },
    { sku: "REA-RT", name: "Retail Pad", price: 5400 },
    { sku: "REA-SV", name: "Service Charge", price: 210 },
    { sku: "REA-EV", name: "Event Hire", price: 960 },
    { sku: "REA-ST", name: "Storage Cage", price: 64 },
  ],
  cpg: [
    { sku: "CPG-CL", name: "Cleaner 750ml", price: 4.2 },
    { sku: "CPG-SN", name: "Snack Case", price: 18 },
    { sku: "CPG-BV", name: "Beverage Pack", price: 9.6 },
    { sku: "CPG-PC", name: "Personal Care", price: 6.4 },
    { sku: "CPG-HM", name: "Home Care", price: 7.8 },
    { sku: "CPG-BT", name: "Beauty SKU", price: 14 },
    { sku: "CPG-PB", name: "Private Brand", price: 5.1 },
    { sku: "CPG-PR", name: "Promo Shipper", price: 36 },
  ],
};

export const COMPANY = {
  name: "Apex Meridian Group",
  fiscalYearStart: "2026-01-01",
  baseCurrency: "USD" as CurrencyCode,
  timezone: "Australia/Sydney",
};

export const SHEET_NAMES = [
  "Instructions",
  "Meta",
  "FX",
  "Departments",
  "Revenue",
  "Expenses",
  "Assets",
  "Licenses",
  "Upcoming",
  "Sales",
  "Forecast",
  "Demand",
  "Turnover",
] as const;

export function industryById(id: string) {
  return INDUSTRIES.find((i) => i.id === id);
}

export function departmentById(id: string) {
  return DEPARTMENTS.find((d) => d.id === id);
}
