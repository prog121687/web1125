"use strict";

const byId = (id) => document.getElementById(id);
const form = byId("trip-form");
const field = (name) => form.elements.namedItem(name);
const storageKey = "work4.travel-expenses.v1";
const transportRows = byId("transport-rows");
const lodgingRows = byId("lodging-rows");
const { calculate, won, caps } = travelCalculator;
const formFields = [
  "kind", "start", "end", "startTime", "endTime", "localVehicle", "grade",
  "halfDays", "noMealDays", "mileageSavings", "samePlace", "special",
];
let activeId;
let currentTrip;
let currentResult;
let records = [];

function status(message) {
  byId("storage-message").textContent = message;
}

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (!Array.isArray(saved)) throw new Error("Invalid record list");
  records = saved;
} catch {
  status("이 브라우저에서 저장한 출장 건을 읽을 수 없습니다.");
}

function saveRecords(next) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    records = next;
    renderRecords();
    return true;
  } catch {
    status("출장 건을 저장할 수 없습니다. 이 브라우저의 로컬 저장 설정을 확인하세요.");
    return false;
  }
}

function renderRecords() {
  const list = byId("record-list");
  list.replaceChildren();
  byId("record-count").textContent = records.length;
  if (!records.length) {
    list.append(element("li", "저장한 출장 건이 없습니다.", "hint"));
    return;
  }
  for (const record of records) {
    const row = element("li", "", "record");
    const copy = element("div");
    copy.append(element("strong", record.name), element("p",
      record.trip.start + " ~ " + record.trip.end + " · " +
      (record.trip.kind === "local" ? "근무지 내" : "근무지 외"), "hint"));
    const controls = element("div", "", "record-buttons");
    const open = button("열기", "small-button", () => loadTrip(record));
    const remove = button("삭제", "remove", () => {
      if (!window.confirm("‘" + record.name + "’ 출장 건을 삭제할까요?")) return;
      if (saveRecords(records.filter((item) => item.id !== record.id))) {
        if (activeId === record.id) activeId = undefined;
        status("출장 건을 삭제했습니다.");
      }
    });
    open.setAttribute("aria-label", record.name + " 열기");
    remove.setAttribute("aria-label", record.name + " 삭제");
    controls.append(open, remove);
    row.append(copy, controls);
    list.append(row);
  }
}

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, className, action) {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function getValue(control) {
  return control.type === "checkbox" ? control.checked : control.value;
}

function setValue(control, value) {
  if (control.type === "checkbox") control.checked = Boolean(value);
  else control.value = value;
}

function expenseValue(row) {
  return Object.fromEntries(Array.from(row.querySelectorAll("[data-field]"),
    (control) => [control.dataset.field, getValue(control)]));
}

function refreshExpenseRows() {
  [...transportRows.children, ...lodgingRows.children].forEach((row) => {
    const transport = row.parentElement === transportRows;
    const name = transport ? "교통편" : "숙박";
    const index = Array.prototype.indexOf.call(row.parentElement.children, row) + 1;
    row.querySelector(".expense-title").textContent = name + " " + index;
    row.querySelector(".remove").setAttribute("aria-label", name + " " + index + " 삭제");
    if (transport) {
      const { mode } = expenseValue(row);
      const amount = row.querySelector('[data-field="amount"]');
      amount.disabled = mode === "official";
      const first = field("grade").value === "1";
      const rail = field("grade").value ? (first ? "특실" : "일반실") : "지급 구분에 따른 좌석";
      const sea = field("grade").value ? (first ? "1등급" : "2등급") : "지급 구분에 따른 등급";
      const messages = {
        rail: rail + " 인정 운임", sea: sea + " 인정 운임",
        air: "소속기관에서 확인한 좌석 등급의 인정 운임",
        bus: "승인된 요율 범위의 인정 운임",
        car: "별표 2에 따른 철도 또는 버스 기준 운임",
        approvedCar: "기관 기준에 따라 인정된 연료비·통행료 등",
        official: "공용 교통수단 운임은 지급액 0원으로 계산합니다.",
      };
      row.querySelector(".expense-hint").textContent = messages[mode];
    } else {
      const extra = row.querySelector('[data-field="extra"]');
      const cap = caps[expenseValue(row).region];
      const capped = field("grade").value === "2";
      extra.disabled = !capped;
      extra.closest("label").hidden = !capped;
      if (capped && cap) {
        extra.closest("label").lastChild.textContent = " 부득이한 상한 " + won(cap) + " 초과분 추가 정산 요건 충족";
      }
    }
  });
}

function addExpense(type, data, focus = false) {
  const row = byId(type + "-template").content.firstElementChild.cloneNode(true);
  const container = type === "transport" ? transportRows : lodgingRows;
  if (data) {
    for (const control of row.querySelectorAll("[data-field]")) {
      setValue(control, data[control.dataset.field]);
    }
  }
  row.querySelector(".remove").addEventListener("click", () => {
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    refreshExpenseRows();
    markDirty();
    (next?.querySelector(".remove") || byId("add-" + type)).focus();
  });
  container.append(row);
  refreshExpenseRows();
  if (focus) row.querySelector("select").focus();
}

function refreshForm() {
  const local = field("kind").value === "local";
  byId("local-fields").hidden = !local;
  byId("local-fields").disabled = !local;
  byId("outside-fields").hidden = local;
  byId("outside-fields").disabled = local;
  refreshExpenseRows();
}

function readTrip() {
  const trip = Object.fromEntries(formFields.map((name) => [name, getValue(field(name))]));
  trip.transport = Array.from(transportRows.children, expenseValue);
  trip.lodging = Array.from(lodgingRows.children, expenseValue);
  return trip;
}

function fillList(id, items) {
  byId(id).replaceChildren(...items.map((item) => element("li", item)));
}

function showResult(result, trip) {
  byId("save-message").textContent = "";
  byId("total").replaceChildren(document.createTextNode(won(result.total).slice(0, -1) + " "), element("span", "원"));
  byId("result-subtitle").textContent = result.period;
  byId("result-dates").textContent = "출장 기간 " + (
    trip.start === trip.end ? trip.start : trip.start + " ~ " + trip.end
  );
  byId("result-dates").hidden = false;
  byId("result-buttons").hidden = false;
  byId("export-message").hidden = true;
  byId("breakdown").replaceChildren(...result.rows.map(({ label, amount, detail }) => {
    const tr = element("tr");
    const title = element("th");
    title.scope = "row";
    title.append(element("strong", label), element("p", detail, "hint"));
    tr.append(title, element("td", won(amount)));
    return tr;
  }));
  fillList("calculation-notes", result.notes);
  byId("calculation-notes").hidden = result.notes.length === 0;
  fillList("settlement-items", result.settlement);
  byId("settlement").hidden = result.settlement.length === 0;
  byId("result-breakdown").hidden = false;
  byId("save-panel").hidden = false;
  byId("form-message").hidden = true;
}

function clearResult() {
  currentTrip = undefined;
  currentResult = undefined;
  byId("total").replaceChildren(document.createTextNode("— "), element("span", "원"));
  byId("result-subtitle").textContent = "출장 정보를 입력하고 여비를 계산하세요.";
  byId("result-dates").hidden = true;
  byId("result-buttons").hidden = true;
  byId("export-message").hidden = true;
  byId("result-breakdown").hidden = true;
  byId("settlement").hidden = true;
  byId("save-panel").hidden = true;
  byId("form-message").hidden = true;
}

function markDirty() {
  const calculated = Boolean(currentTrip);
  clearResult();
  if (calculated) byId("result-subtitle").textContent = "조건이 변경되었습니다. 다시 계산하세요.";
}

function loadTrip(record) {
  const { trip } = record;
  form.reset();
  transportRows.replaceChildren();
  lodgingRows.replaceChildren();
  for (const name of formFields) setValue(field(name), trip[name]);
  trip.transport.forEach((data) => addExpense("transport", data));
  trip.lodging.forEach((data) => addExpense("lodging", data));
  byId("adjustments").open = trip.samePlace || trip.special ||
    Number(trip.noMealDays) > 0 || Number(trip.mileageSavings) > 0;
  activeId = record.id;
  byId("record-name").value = record.name;
  refreshForm();
  clearResult();
  form.requestSubmit();
  form.scrollIntoView({ block: "start" });
  field("start").focus({ preventScroll: true });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const trip = readTrip();
    const result = calculate(trip);
    showResult(result, trip);
    currentTrip = trip;
    currentResult = result;
    if (!byId("record-name").value.trim()) byId("record-name").value = trip.start + " 출장";
    byId("result-title").focus();
  } catch (error) {
    clearResult();
    const message = byId("form-message");
    message.textContent = error.message;
    message.hidden = false;
  }
});

form.addEventListener("input", () => {
  refreshForm();
  markDirty();
});

for (const type of ["transport", "lodging"]) {
  byId("add-" + type).addEventListener("click", () => {
    addExpense(type, undefined, true);
    markDirty();
  });
}

byId("new-trip").addEventListener("click", () => {
  form.reset();
  transportRows.replaceChildren();
  lodgingRows.replaceChildren();
  byId("adjustments").open = false;
  byId("record-name").value = "";
  activeId = undefined;
  refreshForm();
  clearResult();
  field("start").focus();
});

byId("save").addEventListener("click", () => {
  if (!currentTrip) return;
  const name = byId("record-name").value.trim() || currentTrip.start + " 출장";
  const id = activeId || Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const next = [{ id, name, trip: currentTrip }, ...records.filter((record) => record.id !== id)];
  if (saveRecords(next)) {
    activeId = id;
    const message = "‘" + name + "’ 출장 건을 저장했습니다.";
    byId("save-message").textContent = message;
    status(message);
  } else {
    byId("save-message").textContent = byId("storage-message").textContent;
  }
});

byId("print-result").addEventListener("click", () => {
  if (currentTrip) window.print();
});

byId("export-result").addEventListener("click", async (event) => {
  if (!currentTrip || !currentResult) return;
  const trip = currentTrip;
  const control = event.currentTarget;
  const message = byId("export-message");
  const name = byId("record-name").value.trim() || trip.start + " 출장";
  control.disabled = true;
  message.hidden = true;
  try {
    await travelWorkbook.download(trip, currentResult, name, byId("result-source").textContent);
  } catch {
    if (trip === currentTrip) {
      message.textContent = "엑셀 파일을 생성하지 못했습니다. 다시 시도하세요.";
      message.hidden = false;
    }
  } finally {
    control.disabled = false;
  }
});

window.addEventListener("beforeprint", () => {
  const name = byId("record-name").value.trim();
  byId("print-name").textContent = currentTrip ? name : "";
  byId("print-name").hidden = !currentTrip || !name;
  document.querySelector(".print-heading").hidden = !currentTrip;
});

window.addEventListener("afterprint", () => {
  document.querySelector(".print-heading").hidden = true;
});

const criteriaButton = byId("open-criteria");
const criteriaDialog = byId("criteria-dialog");

criteriaButton.addEventListener("click", () => {
  criteriaDialog.showModal();
  criteriaDialog.scrollTop = 0;
});
criteriaDialog.addEventListener("close", () => criteriaButton.focus());

refreshForm();
renderRecords();
