import {
  calculateLine,
  calculateTotals,
  createDefaultState,
  createGrade,
  createMaterial,
  createOtherCost,
  getActiveGrade,
  normalizeStoredState,
  priceUnitsForQuantity,
} from "./calculator.js";

const STORAGE_KEY = "concrete-cost-calculator.v1";

const materialsList = document.querySelector("#materialsList");
const otherCostsList = document.querySelector("#otherCostsList");
const saveStatus = document.querySelector("#saveStatus");
const gradeOptions = document.querySelector("#gradeOptions");
const newGradeName = document.querySelector("#newGradeName");
const gradeMessage = document.querySelector("#gradeMessage");

const summaryElements = {
  postDeductionCost: document.querySelector("#postDeductionCost"),
  grossTotal: document.querySelector("#grossTotal"),
  deductibleTax: document.querySelector("#deductibleTax"),
  nonDeductibleTax: document.querySelector("#nonDeductibleTax"),
  taxAmount: document.querySelector("#taxAmount"),
  materialsGross: document.querySelector("#materialsGross"),
  otherGross: document.querySelector("#otherGross"),
  summaryError: document.querySelector("#summaryError"),
  summaryGrade: document.querySelector("#summaryGrade"),
};

const currencyFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

let saveTimer;
let state = loadState();

function loadState() {
  try {
    return (
      normalizeStoredState(localStorage.getItem(STORAGE_KEY)) ??
      createDefaultState()
    );
  } catch {
    return createDefaultState();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCurrency(value) {
  return `¥${currencyFormatter.format(Number.isFinite(value) ? value : 0)}`;
}

function priceModeOptions(selectedMode, kind = "material") {
  const suffix = kind === "other" ? "金额" : "单价";
  return `
    <option value="included" ${selectedMode === "included" ? "selected" : ""}>含税${suffix}</option>
    <option value="excluded" ${selectedMode === "excluded" ? "selected" : ""}>未税${suffix}</option>
  `;
}

function quantityUnitOptions(selectedUnit) {
  return `
    <option value="kg" ${selectedUnit === "kg" ? "selected" : ""}>kg</option>
    <option value="m3" ${selectedUnit === "m3" ? "selected" : ""}>m³</option>
  `;
}

function priceUnitOptions(line) {
  const selectedUnit = line.priceUnit;
  const labels = {
    kg: "元/kg",
    t: "元/吨",
    m3: "元/m³",
  };

  return priceUnitsForQuantity(line.quantityUnit)
    .map(
      (unit) =>
        `<option value="${unit}" ${selectedUnit === unit ? "selected" : ""}>${labels[unit]}</option>`,
    )
    .join("");
}

function taxPresetOptions(rate) {
  const options = ["13", "9", "6", "3", "1", "0"];
  const matchingRate = options.includes(String(rate)) ? String(rate) : "";

  return `
    <option value="" ${matchingRate === "" ? "selected" : ""}>常用</option>
    ${options
      .map(
        (value) =>
          `<option value="${value}" ${matchingRate === value ? "selected" : ""}>${value}%</option>`,
      )
      .join("")}
  `;
}

function materialRowTemplate(line, quantity, index) {
  return `
    <article class="cost-row" data-kind="material" data-id="${escapeHtml(line.id)}">
      <div class="row-heading">
        <span class="row-number">${String(index + 1).padStart(2, "0")}</span>
        <input
          class="row-name"
          data-field="name"
          value="${escapeHtml(line.name)}"
          placeholder="材料名称"
          aria-label="材料名称"
          maxlength="40"
        />
        <div class="row-result" data-line-result>—</div>
        <button
          class="delete-button"
          data-action="delete"
          type="button"
          aria-label="删除${escapeHtml(line.name || "该材料")}"
        >删除</button>
      </div>
      <div class="row-fields">
        <label class="field">
          <span>每方用量</span>
          <div class="field-group">
            <input
              data-field="quantity"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              value="${escapeHtml(quantity)}"
              placeholder="0"
              aria-label="每方用量"
            />
            <select data-field="quantityUnit" aria-label="用量单位">
              ${quantityUnitOptions(line.quantityUnit)}
            </select>
          </div>
        </label>
        <label class="field">
          <span>材料单价</span>
          <div class="field-group">
            <input
              data-field="unitPrice"
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              value="${escapeHtml(line.unitPrice)}"
              placeholder="0.00"
              aria-label="材料单价"
            />
            <select data-field="priceUnit" aria-label="单价单位">
              ${priceUnitOptions(line)}
            </select>
          </div>
        </label>
        <label class="field">
          <span>单价口径</span>
          <select data-field="priceMode" aria-label="单价口径">
            ${priceModeOptions(line.priceMode, "material")}
          </select>
        </label>
        <label class="field">
          <span>税率（%）</span>
          <div class="field-group tax-combo">
            <input
              data-field="taxRate"
              type="number"
              inputmode="decimal"
              min="0"
              max="100"
              step="any"
              value="${escapeHtml(line.taxRate)}"
              placeholder="0"
              aria-label="税率"
            />
            <select data-action="tax-preset" aria-label="常用税率">
              ${taxPresetOptions(line.taxRate)}
            </select>
          </div>
        </label>
        <label class="field">
          <span>可抵扣比例（%）</span>
          <input
            data-field="deductiblePercent"
            type="number"
            inputmode="decimal"
            min="0"
            max="100"
            step="any"
            value="${escapeHtml(line.deductiblePercent)}"
            placeholder="0"
            aria-label="可抵扣比例"
          />
        </label>
      </div>
    </article>
  `;
}

function otherCostRowTemplate(line, index) {
  return `
    <article class="cost-row" data-kind="other" data-id="${escapeHtml(line.id)}">
      <div class="row-heading">
        <span class="row-number">${String(index + 1).padStart(2, "0")}</span>
        <input
          class="row-name"
          data-field="name"
          value="${escapeHtml(line.name)}"
          placeholder="例如：搅拌、人工、运输"
          aria-label="费用名称"
          maxlength="40"
        />
        <div class="row-result" data-line-result>—</div>
        <button
          class="delete-button"
          data-action="delete"
          type="button"
          aria-label="删除${escapeHtml(line.name || "该费用")}"
        >删除</button>
      </div>
      <div class="row-fields fees">
        <label class="field">
          <span>每方金额（元/m³）</span>
          <input
            data-field="amount"
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            value="${escapeHtml(line.amount)}"
            placeholder="0.00"
            aria-label="每方金额"
          />
        </label>
        <label class="field">
          <span>金额口径</span>
          <select data-field="priceMode" aria-label="金额口径">
            ${priceModeOptions(line.priceMode, "other")}
          </select>
        </label>
        <label class="field">
          <span>税率（%）</span>
          <div class="field-group tax-combo">
            <input
              data-field="taxRate"
              type="number"
              inputmode="decimal"
              min="0"
              max="100"
              step="any"
              value="${escapeHtml(line.taxRate)}"
              placeholder="0"
              aria-label="税率"
            />
            <select data-action="tax-preset" aria-label="常用税率">
              ${taxPresetOptions(line.taxRate)}
            </select>
          </div>
        </label>
        <label class="field">
          <span>可抵扣比例（%）</span>
          <input
            data-field="deductiblePercent"
            type="number"
            inputmode="decimal"
            min="0"
            max="100"
            step="any"
            value="${escapeHtml(line.deductiblePercent)}"
            placeholder="0"
            aria-label="可抵扣比例"
          />
        </label>
      </div>
    </article>
  `;
}

function renderGradeTabs() {
  const activeGrade = getActiveGrade(state);
  summaryElements.summaryGrade.textContent = activeGrade.name;
  gradeOptions.innerHTML = state.grades
    .map(
      (grade) => `
        <button
          class="grade-tab ${grade.id === activeGrade.id ? "active" : ""}"
          data-action="select-grade"
          data-grade-id="${escapeHtml(grade.id)}"
          type="button"
          role="tab"
          aria-selected="${grade.id === activeGrade.id}"
        >${escapeHtml(grade.name)}</button>
      `,
    )
    .join("");
}

function renderRows() {
  const activeGrade = getActiveGrade(state);
  renderGradeTabs();

  materialsList.innerHTML = state.materials.length
    ? state.materials
        .map((line, index) =>
          materialRowTemplate(line, activeGrade.quantities[line.id] ?? "", index),
        )
        .join("")
    : '<div class="empty-state">尚未添加原材料，点击“添加材料”开始。</div>';

  otherCostsList.innerHTML = state.otherCosts.length
    ? state.otherCosts.map(otherCostRowTemplate).join("")
    : '<div class="empty-state">暂无其他费用，可按需添加。</div>';

  updateSummary();
}

function findLine(kind, id) {
  const collection = kind === "material" ? state.materials : state.otherCosts;
  return collection.find((line) => line.id === id);
}

function updateLineResult(row, result) {
  const resultElement = row.querySelector("[data-line-result]");
  row.classList.toggle("invalid", !result.valid);

  if (result.valid) {
    resultElement.classList.remove("error");
    resultElement.innerHTML = `抵扣后 <strong>${formatCurrency(result.postDeductionAmount)}</strong>`;
  } else {
    resultElement.classList.add("error");
    resultElement.textContent = result.errors.join("；");
  }
}

function updateSummary() {
  const totals = calculateTotals(state);
  const resultsById = new Map(
    [...totals.materialResults, ...totals.otherResults].map((result) => [
      result.id,
      result,
    ]),
  );

  document.querySelectorAll(".cost-row").forEach((row) => {
    const result = resultsById.get(row.dataset.id);
    if (result) updateLineResult(row, result);
  });

  summaryElements.summaryError.hidden = totals.valid;
  const fields = {
    postDeductionCost: totals.postDeductionCost,
    grossTotal: totals.grossTotal,
    deductibleTax: totals.deductibleTax,
    nonDeductibleTax: totals.nonDeductibleTax,
    taxAmount: totals.taxAmount,
    materialsGross: totals.materialsGross,
    otherGross: totals.otherGross,
  };

  Object.entries(fields).forEach(([key, value]) => {
    summaryElements[key].textContent = totals.valid ? formatCurrency(value) : "—";
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveStatus.textContent = "保存中…";
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveStatus.textContent = `已保存 ${new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    } catch {
      saveStatus.textContent = "本机保存失败";
    }
  }, 180);
}

function updateField(control) {
  const row = control.closest(".cost-row");
  if (!row) return;

  const kind = row.dataset.kind;
  const line = findLine(kind, row.dataset.id);
  const field = control.dataset.field;
  if (!line || !field) return;

  if (kind === "material" && field === "quantity") {
    getActiveGrade(state).quantities[line.id] = control.value;
  } else {
    line[field] = control.value;
  }

  if (field === "quantityUnit") {
    const allowedPriceUnits = priceUnitsForQuantity(line.quantityUnit);
    if (!allowedPriceUnits.includes(line.priceUnit)) {
      line.priceUnit = allowedPriceUnits[0];
    }
    renderRows();
  } else {
    updateSummary();
  }

  scheduleSave();
}

function handleTaxPreset(control) {
  if (!control.value) return;
  const row = control.closest(".cost-row");
  const line = findLine(row.dataset.kind, row.dataset.id);
  if (!line) return;

  line.taxRate = control.value;
  renderRows();
  scheduleSave();
}

function handleDelete(button) {
  const row = button.closest(".cost-row");
  const kind = row.dataset.kind;
  const collection = kind === "material" ? state.materials : state.otherCosts;
  const index = collection.findIndex((line) => line.id === row.dataset.id);
  if (index === -1) return;

  const [removedLine] = collection.splice(index, 1);
  if (kind === "material") {
    state.grades.forEach((grade) => {
      delete grade.quantities[removedLine.id];
    });
  }
  renderRows();
  scheduleSave();
}

function selectGrade(gradeId) {
  if (!state.grades.some((grade) => grade.id === gradeId)) return;
  state.activeGradeId = gradeId;
  gradeMessage.textContent = "";
  renderRows();
  scheduleSave();
}

function addGrade() {
  const name = newGradeName.value.trim();
  if (!name) {
    gradeMessage.textContent = "请输入强度等级，例如 C45。";
    newGradeName.focus();
    return;
  }

  const existing = state.grades.find(
    (grade) =>
      grade.name.toLocaleUpperCase("zh-CN") ===
      name.toLocaleUpperCase("zh-CN"),
  );
  if (existing) {
    selectGrade(existing.id);
    gradeMessage.textContent = `${existing.name} 已存在，已切换到该等级。`;
    return;
  }

  const grade = createGrade(name, state.materials);
  state.grades.push(grade);
  state.activeGradeId = grade.id;
  newGradeName.value = "";
  gradeMessage.textContent = `已添加 ${name}，可录入对应配合比。`;
  renderRows();
  scheduleSave();
}

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-field]")) {
    updateField(event.target);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-field]")) {
    updateField(event.target);
  } else if (event.target.matches('[data-action="tax-preset"]')) {
    handleTaxPreset(event.target);
  }
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  if (target.dataset.action === "delete") {
    handleDelete(target);
  } else if (target.dataset.action === "select-grade") {
    selectGrade(target.dataset.gradeId);
  }
});

document.querySelector("#addMaterial").addEventListener("click", () => {
  const material = createMaterial();
  state.materials.push(material);
  state.grades.forEach((grade) => {
    grade.quantities[material.id] = "";
  });
  renderRows();
  scheduleSave();
});

document.querySelector("#addOtherCost").addEventListener("click", () => {
  state.otherCosts.push(createOtherCost());
  renderRows();
  scheduleSave();
});

document.querySelector("#addGrade").addEventListener("click", addGrade);
newGradeName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addGrade();
  }
});

document.querySelector("#clearAll").addEventListener("click", () => {
  if (!window.confirm("确定清空全部配合比、单价和费用数据吗？此操作无法撤销。")) {
    return;
  }

  state = createDefaultState();
  renderRows();
  scheduleSave();
});

renderRows();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // The calculator still works online if service worker registration fails.
    });
  });
}
