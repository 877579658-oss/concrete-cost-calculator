export const STATE_VERSION = 1;

export const QUANTITY_UNITS = ["kg", "m3"];
export const PRICE_MODES = ["included", "excluded"];

const PRICE_UNITS_BY_QUANTITY = {
  kg: ["kg", "t"],
  m3: ["m3"],
};

function makeId(prefix) {
  const randomPart =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

export function createMaterial(overrides = {}) {
  return {
    id: makeId("material"),
    name: "",
    quantity: "",
    quantityUnit: "kg",
    unitPrice: "",
    priceUnit: "t",
    priceMode: "included",
    taxRate: "13",
    deductiblePercent: "100",
    ...overrides,
  };
}

export function createOtherCost(overrides = {}) {
  return {
    id: makeId("other"),
    name: "",
    amount: "",
    priceMode: "included",
    taxRate: "0",
    deductiblePercent: "0",
    ...overrides,
  };
}

export function createDefaultState() {
  return {
    version: STATE_VERSION,
    materials: ["水泥", "粉煤灰", "砂", "石", "水", "外加剂"].map((name) =>
      createMaterial({ name }),
    ),
    otherCosts: [],
  };
}

export function priceUnitsForQuantity(quantityUnit) {
  return PRICE_UNITS_BY_QUANTITY[quantityUnit] ?? [];
}

function readNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value ?? "").trim();
  if (text === "") {
    return 0;
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function percentIsValid(value) {
  return value !== null && value >= 0 && value <= 100;
}

function applyTax(amount, priceMode, taxRate, deductiblePercent) {
  const rate = taxRate / 100;
  const deduction = deductiblePercent / 100;

  const taxAmount =
    priceMode === "included"
      ? amount - amount / (1 + rate)
      : amount * rate;
  const grossAmount = priceMode === "included" ? amount : amount + taxAmount;
  const deductibleTax = taxAmount * deduction;

  return {
    taxAmount,
    grossAmount,
    deductibleTax,
    postDeductionAmount: grossAmount - deductibleTax,
  };
}

export function calculateLine(line, kind = "material") {
  const errors = [];
  const taxRate = readNumber(line.taxRate);
  const deductiblePercent = readNumber(line.deductiblePercent);
  const priceMode = PRICE_MODES.includes(line.priceMode)
    ? line.priceMode
    : "included";

  if (!percentIsValid(taxRate)) {
    errors.push("税率须在 0%–100% 之间");
  }
  if (!percentIsValid(deductiblePercent)) {
    errors.push("抵扣比例须在 0%–100% 之间");
  }
  if (!PRICE_MODES.includes(line.priceMode)) {
    errors.push("单价口径无效");
  }

  let untaxedOrIncludedAmount = 0;

  if (kind === "material") {
    const quantity = readNumber(line.quantity);
    const unitPrice = readNumber(line.unitPrice);
    const validPriceUnits = priceUnitsForQuantity(line.quantityUnit);

    if (!QUANTITY_UNITS.includes(line.quantityUnit)) {
      errors.push("用量单位无效");
    } else if (!validPriceUnits.includes(line.priceUnit)) {
      errors.push("单价单位与用量单位不匹配");
    }
    if (quantity === null || quantity < 0) {
      errors.push("每方用量须为非负数");
    }
    if (unitPrice === null || unitPrice < 0) {
      errors.push("单价须为非负数");
    }

    if (
      quantity !== null &&
      unitPrice !== null &&
      quantity >= 0 &&
      unitPrice >= 0 &&
      QUANTITY_UNITS.includes(line.quantityUnit) &&
      validPriceUnits.includes(line.priceUnit)
    ) {
      if (line.quantityUnit === "kg" && line.priceUnit === "t") {
        untaxedOrIncludedAmount = (quantity / 1000) * unitPrice;
      } else {
        untaxedOrIncludedAmount = quantity * unitPrice;
      }
    }
  } else {
    const amount = readNumber(line.amount);
    if (amount === null || amount < 0) {
      errors.push("每方金额须为非负数");
    } else {
      untaxedOrIncludedAmount = amount;
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      untaxedOrIncludedAmount: 0,
      taxAmount: 0,
      grossAmount: 0,
      deductibleTax: 0,
      postDeductionAmount: 0,
    };
  }

  return {
    valid: true,
    errors: [],
    untaxedOrIncludedAmount,
    ...applyTax(
      untaxedOrIncludedAmount,
      priceMode,
      taxRate,
      deductiblePercent,
    ),
  };
}

export function calculateTotals(state) {
  const materialResults = state.materials.map((line) => ({
    id: line.id,
    ...calculateLine(line, "material"),
  }));
  const otherResults = state.otherCosts.map((line) => ({
    id: line.id,
    ...calculateLine(line, "other"),
  }));
  const allResults = [...materialResults, ...otherResults];

  const sum = (field) =>
    allResults.reduce((total, result) => total + result[field], 0);

  const grossTotal = sum("grossAmount");
  const deductibleTax = sum("deductibleTax");
  const taxAmount = sum("taxAmount");

  return {
    valid: allResults.every((result) => result.valid),
    materialResults,
    otherResults,
    materialsGross: materialResults.reduce(
      (total, result) => total + result.grossAmount,
      0,
    ),
    otherGross: otherResults.reduce(
      (total, result) => total + result.grossAmount,
      0,
    ),
    grossTotal,
    taxAmount,
    deductibleTax,
    nonDeductibleTax: taxAmount - deductibleTax,
    postDeductionCost: grossTotal - deductibleTax,
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumericField(value) {
  return value === "" || (value !== null && Number.isFinite(Number(value)));
}

function normalizeMaterial(value) {
  if (!isRecord(value)) return null;
  const validPriceUnits = priceUnitsForQuantity(value.quantityUnit);

  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !QUANTITY_UNITS.includes(value.quantityUnit) ||
    !validPriceUnits.includes(value.priceUnit) ||
    !PRICE_MODES.includes(value.priceMode) ||
    !isNumericField(value.quantity) ||
    !isNumericField(value.unitPrice) ||
    !isNumericField(value.taxRate) ||
    !isNumericField(value.deductiblePercent)
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    quantity: String(value.quantity ?? ""),
    quantityUnit: value.quantityUnit,
    unitPrice: String(value.unitPrice ?? ""),
    priceUnit: value.priceUnit,
    priceMode: value.priceMode,
    taxRate: String(value.taxRate ?? ""),
    deductiblePercent: String(value.deductiblePercent ?? ""),
  };
}

function normalizeOtherCost(value) {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !PRICE_MODES.includes(value.priceMode) ||
    !isNumericField(value.amount) ||
    !isNumericField(value.taxRate) ||
    !isNumericField(value.deductiblePercent)
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    amount: String(value.amount ?? ""),
    priceMode: value.priceMode,
    taxRate: String(value.taxRate ?? ""),
    deductiblePercent: String(value.deductiblePercent ?? ""),
  };
}

export function normalizeStoredState(value) {
  let state = value;
  if (typeof state === "string") {
    try {
      state = JSON.parse(state);
    } catch {
      return null;
    }
  }

  if (
    !isRecord(state) ||
    state.version !== STATE_VERSION ||
    !Array.isArray(state.materials) ||
    !Array.isArray(state.otherCosts) ||
    state.materials.length > 200 ||
    state.otherCosts.length > 200
  ) {
    return null;
  }

  const materials = state.materials.map(normalizeMaterial);
  const otherCosts = state.otherCosts.map(normalizeOtherCost);
  if (materials.includes(null) || otherCosts.includes(null)) {
    return null;
  }

  const ids = [...materials, ...otherCosts].map((line) => line.id);
  if (new Set(ids).size !== ids.length) {
    return null;
  }

  return {
    version: STATE_VERSION,
    materials,
    otherCosts,
  };
}
