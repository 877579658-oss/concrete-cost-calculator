import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateLine,
  calculateTotals,
  createDefaultState,
  createGrade,
  createMaterial,
  createOtherCost,
  DEFAULT_GRADE_NAMES,
  getActiveGrade,
  normalizeStoredState,
  STATE_VERSION,
} from "./calculator.js";

function closeTo(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be close to ${expected}`,
  );
}

test("kg quantity with price per tonne", () => {
  const result = calculateLine(
    createMaterial({
      quantity: "350",
      quantityUnit: "kg",
      unitPrice: "400",
      priceUnit: "t",
    }),
  );

  assert.equal(result.valid, true);
  closeTo(result.grossAmount, 140);
  closeTo(result.taxAmount, (140 * 13) / 113);
  closeTo(result.deductibleTax, (140 * 13) / 113);
  closeTo(result.postDeductionAmount, 140 / 1.13);
});

test("tax-exclusive price adds VAT to cash outflow", () => {
  const result = calculateLine(
    createMaterial({
      quantity: "350",
      quantityUnit: "kg",
      unitPrice: "1.2",
      priceUnit: "kg",
      priceMode: "excluded",
      taxRate: "13",
      deductiblePercent: "100",
    }),
  );

  assert.equal(result.valid, true);
  closeTo(result.untaxedOrIncludedAmount, 420);
  closeTo(result.taxAmount, 54.6);
  closeTo(result.grossAmount, 474.6);
  closeTo(result.deductibleTax, 54.6);
  closeTo(result.postDeductionAmount, 420);
});

test("partial deduction uses only the selected share", () => {
  const result = calculateLine(
    createMaterial({
      quantity: "1",
      quantityUnit: "m3",
      unitPrice: "100",
      priceUnit: "m3",
      taxRate: "9",
      deductiblePercent: "50",
    }),
  );

  closeTo(result.taxAmount, 100 - 100 / 1.09);
  closeTo(result.deductibleTax, (100 - 100 / 1.09) / 2);
  closeTo(result.postDeductionAmount, 100 - (100 - 100 / 1.09) / 2);
});

test("zero deduction leaves the gross amount in cost", () => {
  const result = calculateLine(
    createMaterial({
      quantity: "100",
      quantityUnit: "kg",
      unitPrice: "10",
      priceUnit: "kg",
      taxRate: "13",
      deductiblePercent: "0",
    }),
  );

  closeTo(result.deductibleTax, 0);
  closeTo(result.postDeductionAmount, 1000);
});

test("blank numeric inputs calculate as zero", () => {
  const result = calculateLine(createMaterial());
  assert.equal(result.valid, true);
  assert.equal(result.grossAmount, 0);
  assert.equal(result.taxAmount, 0);
});

test("other fee uses direct amount per cubic metre", () => {
  const result = calculateLine(
    createOtherCost({
      amount: "25",
      priceMode: "excluded",
      taxRate: "6",
      deductiblePercent: "100",
    }),
    "other",
  );

  closeTo(result.grossAmount, 26.5);
  closeTo(result.deductibleTax, 1.5);
  closeTo(result.postDeductionAmount, 25);
});

test("invalid negatives, percentages and unit pairs fail safely", () => {
  const negativeQuantity = calculateLine(
    createMaterial({
      quantity: "-1",
      unitPrice: "10",
      priceUnit: "t",
    }),
  );
  assert.equal(negativeQuantity.valid, false);
  assert.ok(negativeQuantity.errors.some((error) => error.includes("用量")));

  const badTax = calculateLine(
    createMaterial({
      quantity: "1",
      unitPrice: "1",
      priceUnit: "t",
      taxRate: "101",
    }),
  );
  assert.equal(badTax.valid, false);

  const badDeduction = calculateLine(
    createMaterial({
      quantity: "1",
      unitPrice: "1",
      priceUnit: "t",
      deductiblePercent: "-1",
    }),
  );
  assert.equal(badDeduction.valid, false);

  const mismatchedUnits = calculateLine(
    createMaterial({
      quantity: "1",
      quantityUnit: "m3",
      unitPrice: "1",
      priceUnit: "t",
    }),
  );
  assert.equal(mismatchedUnits.valid, false);
});

test("totals combine materials and other costs without intermediate rounding", () => {
  const state = createDefaultState();
  const material = createMaterial({
    name: "水泥",
    unitPrice: "412.345",
    priceUnit: "t",
    taxRate: "13",
    deductiblePercent: "100",
  });
  const grade = createGrade("C30", [material]);
  grade.quantities[material.id] = "333.333";
  state.materials = [material];
  state.grades = [grade];
  state.activeGradeId = grade.id;
  state.otherCosts = [
    createOtherCost({
      name: "运输",
      amount: "17.777",
      priceMode: "excluded",
      taxRate: "9",
      deductiblePercent: "80",
    }),
  ];

  const totals = calculateTotals(state);
  const materialGross = (333.333 / 1000) * 412.345;
  const otherNet = 17.777;
  const otherGross = otherNet * 1.09;

  assert.equal(totals.valid, true);
  closeTo(totals.grossTotal, materialGross + otherGross);
  closeTo(
    totals.deductibleTax,
    (materialGross - materialGross / 1.13) + otherNet * 0.09 * 0.8,
  );
  closeTo(
    totals.postDeductionCost,
    materialGross + otherGross - totals.deductibleTax,
  );
});

test("stored state round-trips and invalid data is rejected", () => {
  const state = createDefaultState();
  getActiveGrade(state).quantities[state.materials[0].id] = "350";

  const restored = normalizeStoredState(JSON.stringify(state));
  assert.deepEqual(restored, state);
  assert.equal(normalizeStoredState('{"version":999}'), null);
  assert.equal(normalizeStoredState("not-json"), null);
  assert.equal(normalizeStoredState({ version: STATE_VERSION }), null);

  const duplicateIds = structuredClone(state);
  duplicateIds.materials[1].id = duplicateIds.materials[0].id;
  assert.equal(normalizeStoredState(duplicateIds), null);
});

test("default state includes separate common concrete grades", () => {
  const state = createDefaultState();

  assert.equal(state.version, STATE_VERSION);
  assert.deepEqual(
    state.grades.map((grade) => grade.name),
    DEFAULT_GRADE_NAMES,
  );
  assert.equal(getActiveGrade(state).name, "C30");
});

test("each grade keeps its own material quantities", () => {
  const state = createDefaultState();
  const c15 = state.grades.find((grade) => grade.name === "C15");
  const c30 = state.grades.find((grade) => grade.name === "C30");
  const cement = state.materials[0];

  c15.quantities[cement.id] = "220";
  c30.quantities[cement.id] = "350";
  state.activeGradeId = c15.id;
  assert.equal(calculateTotals(state).materialResults[0].valid, true);

  state.activeGradeId = c30.id;
  assert.equal(calculateTotals(state).materialResults[0].valid, true);
  assert.equal(c15.quantities[cement.id], "220");
  assert.equal(c30.quantities[cement.id], "350");
});

test("version one data migrates into an original grade without losing values", () => {
  const legacyMaterial = createMaterial({
    name: "水泥",
    quantity: "350",
    unitPrice: "400",
    priceUnit: "t",
  });
  const legacyState = {
    version: 1,
    materials: [legacyMaterial],
    otherCosts: [
      createOtherCost({ name: "运输", amount: "20", taxRate: "9" }),
    ],
  };

  const migrated = normalizeStoredState(legacyState);
  assert.equal(migrated.version, STATE_VERSION);
  assert.equal(migrated.materials[0].quantity, undefined);
  assert.equal(getActiveGrade(migrated).name, "原配合比");
  assert.equal(
    getActiveGrade(migrated).quantities[legacyMaterial.id],
    "350",
  );
  assert.deepEqual(
    migrated.grades.slice(1).map((grade) => grade.name),
    DEFAULT_GRADE_NAMES,
  );
  assert.equal(migrated.otherCosts[0].amount, "20");
});
