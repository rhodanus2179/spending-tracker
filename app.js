(() => {
  "use strict";

  const STORAGE_KEY = "spending-tracker.records.v3";
  const LEGACY_STORAGE_KEY = "spending-tracker.records.v2";
  const QUICK_AMOUNTS_KEY = "spending-tracker.quick-amounts.v1";
  const DEFAULT_QUICK_AMOUNTS = Object.freeze([150, 400, 1000, 3000]);
  const BACKUP_VERSION = 1;
  const RECENT_LIMIT = 10;
  const TREND_MONTHS = 6;
  const MAX_AMOUNT = 100_000_000;
  const MAX_NOTE_LENGTH = 200;
  const MERGE_WINDOW_MS = 2_000;
  const numberFormat = new Intl.NumberFormat("ja-JP");

  const elements = {
    monthNet: document.querySelector("#monthNet"),
    monthExpense: document.querySelector("#monthExpense"),
    monthSaving: document.querySelector("#monthSaving"),
    dayNet: document.querySelector("#dayNet"),
    weekNet: document.querySelector("#weekNet"),
    yearNet: document.querySelector("#yearNet"),
    allNet: document.querySelector("#allNet"),
    dayRange: document.querySelector("#dayRange"),
    weekRange: document.querySelector("#weekRange"),
    monthRange: document.querySelector("#monthRange"),
    yearRange: document.querySelector("#yearRange"),
    amountButtons: document.querySelector("#amountButtons"),
    customToggle: document.querySelector("#customToggle"),
    customEntry: document.querySelector("#customEntry"),
    customAmount: document.querySelector("#customAmount"),
    customNote: document.querySelector("#customNote"),
    quickSettings: document.querySelector("#quickSettings"),
    quickAmountInputs: [...document.querySelectorAll("[data-quick-setting]")],
    resetQuickAmountsButton: document.querySelector("#resetQuickAmountsButton"),
    lastAction: document.querySelector("#lastAction"),
    lastActionMessage: document.querySelector("#lastActionMessage"),
    addNoteButton: document.querySelector("#addNoteButton"),
    undoButton: document.querySelector("#undoButton"),
    recentRecords: document.querySelector("#recentRecords"),
    emptyRecords: document.querySelector("#emptyRecords"),
    monthlyTrend: document.querySelector("#monthlyTrend"),
    exportJsonButton: document.querySelector("#exportJsonButton"),
    exportCsvButton: document.querySelector("#exportCsvButton"),
    importButton: document.querySelector("#importButton"),
    importFile: document.querySelector("#importFile"),
    resetButton: document.querySelector("#resetButton"),
    statusMessage: document.querySelector("#statusMessage")
  };

  let records = loadRecords();
  let quickAmounts = loadQuickAmounts();
  let lastAddedRecordId = null;
  let activeMerge = null;

  function createId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeRecord(record) {
    if (!record || typeof record !== "object") return null;
    const amount = Number(record.amount);
    const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_AMOUNT) return null;
    if (Number.isNaN(Date.parse(createdAt))) return null;

    const note = typeof record.note === "string"
      ? record.note.trim().slice(0, MAX_NOTE_LENGTH)
      : "";

    return {
      id: typeof record.id === "string" && record.id ? record.id : createId(),
      amount: Math.trunc(amount),
      createdAt,
      note
    };
  }

  function readRecordArray(key) {
    const stored = JSON.parse(localStorage.getItem(key));
    if (!Array.isArray(stored)) return [];
    return stored.map(normalizeRecord).filter(Boolean);
  }

  function loadRecords() {
    try {
      const current = readRecordArray(STORAGE_KEY);
      if (current.length > 0 || localStorage.getItem(STORAGE_KEY) !== null) return current;

      const legacy = readRecordArray(LEGACY_STORAGE_KEY);
      if (legacy.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
      }
      return legacy;
    } catch (error) {
      console.warn("保存データを読み込めませんでした。", error);
      return [];
    }
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function normalizeQuickAmounts(value) {
    if (!Array.isArray(value) || value.length !== DEFAULT_QUICK_AMOUNTS.length) return null;
    const amounts = value.map(Number);
    if (amounts.some((amount) => !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT)) return null;
    if (new Set(amounts).size !== amounts.length) return null;
    return amounts;
  }

  function loadQuickAmounts() {
    try {
      const stored = JSON.parse(localStorage.getItem(QUICK_AMOUNTS_KEY));
      return normalizeQuickAmounts(stored) ?? [...DEFAULT_QUICK_AMOUNTS];
    } catch (error) {
      console.warn("クイック金額設定を読み込めませんでした。", error);
      return [...DEFAULT_QUICK_AMOUNTS];
    }
  }

  function saveQuickAmounts() {
    localStorage.setItem(QUICK_AMOUNTS_KEY, JSON.stringify(quickAmounts));
  }

  function renderQuickAmounts() {
    const buttons = elements.amountButtons.querySelectorAll("[data-quick-index][data-kind]");
    for (const button of buttons) {
      const index = Number(button.dataset.quickIndex);
      const amount = quickAmounts[index];
      if (!Number.isInteger(amount)) continue;
      const signedAmount = button.dataset.kind === "expense" ? -amount : amount;
      button.dataset.amount = String(signedAmount);
      button.textContent = `${signedAmount < 0 ? "−" : "＋"}${formatAmount(amount)}円`;
    }

    for (const input of elements.quickAmountInputs) {
      const index = Number(input.dataset.quickSetting);
      if (Number.isInteger(quickAmounts[index])) input.value = String(quickAmounts[index]);
    }
  }

  function resetMergeWindow() {
    activeMerge = null;
  }

  function isSameLocalDay(dateA, dateB) {
    return dateA.getFullYear() === dateB.getFullYear()
      && dateA.getMonth() === dateB.getMonth()
      && dateA.getDate() === dateB.getDate();
  }

  function getMergeTarget(candidate, now) {
    if (!activeMerge || now.getTime() - activeMerge.lastInputAt > MERGE_WINDOW_MS) return null;

    const record = records.find((item) => item.id === activeMerge.recordId);
    if (!record) return null;
    if (!isSameLocalDay(new Date(record.createdAt), now)) return null;
    if (record.note && candidate.note && record.note !== candidate.note) return null;

    const mergedAmount = record.amount + candidate.amount;
    if (Math.abs(mergedAmount) > MAX_AMOUNT) return null;

    return { record, mergedAmount, mergedNote: candidate.note || record.note };
  }

  function addRecord(amount, note = "") {
    const now = new Date();
    const candidate = normalizeRecord({
      id: createId(),
      amount,
      createdAt: now.toISOString(),
      note
    });
    if (!candidate) return;

    const mergeTarget = getMergeTarget(candidate, now);
    if (mergeTarget) {
      if (mergeTarget.mergedAmount === 0) {
        records = records.filter((item) => item.id !== mergeTarget.record.id);
        saveRecords();
        render();
        hideLastAction();
        announce("連続入力の合計が0円になったため、記録を取り消しました。");
        return;
      }

      mergeTarget.record.amount = mergeTarget.mergedAmount;
      mergeTarget.record.note = mergeTarget.mergedNote;
      lastAddedRecordId = mergeTarget.record.id;
      activeMerge = {
        recordId: mergeTarget.record.id,
        lastInputAt: now.getTime()
      };
      saveRecords();
      render();
      showLastAction(mergeTarget.record);
      announce(`連続入力を合算して${formatSignedAmount(mergeTarget.record.amount)}円を記録しました。`);
      return;
    }

    records.push(candidate);
    lastAddedRecordId = candidate.id;
    activeMerge = {
      recordId: candidate.id,
      lastInputAt: now.getTime()
    };
    saveRecords();
    render();
    showLastAction(candidate);
    announce(`${formatSignedAmount(candidate.amount)}円を記録しました。`);
  }

  function deleteRecord(id, { confirmDelete = true } = {}) {
    const record = records.find((item) => item.id === id);
    if (!record) return false;
    if (confirmDelete && !window.confirm(`${formatSignedAmount(record.amount)}円の記録を削除しますか？`)) {
      return false;
    }

    records = records.filter((item) => item.id !== id);
    if (activeMerge?.recordId === id) resetMergeWindow();
    if (lastAddedRecordId === id) hideLastAction();
    saveRecords();
    render();
    return true;
  }

  function undoLastRecord() {
    if (!lastAddedRecordId) return;
    const record = records.find((item) => item.id === lastAddedRecordId);
    if (!record) {
      hideLastAction();
      return;
    }

    const amount = record.amount;
    resetMergeWindow();
    deleteRecord(record.id, { confirmDelete: false });
    announce(`${formatSignedAmount(amount)}円の記録を取り消しました。`);
  }

  function editNote(id) {
    const record = records.find((item) => item.id === id);
    if (!record) return;
    resetMergeWindow();

    const input = window.prompt("メモを入力してください（空欄で削除）", record.note);
    if (input === null) return;

    record.note = input.trim().slice(0, MAX_NOTE_LENGTH);
    saveRecords();
    renderRecentRecords();
    if (lastAddedRecordId === id) showLastAction(record);
    announce(record.note ? "メモを保存しました。" : "メモを削除しました。");
  }

  function addNoteToLastRecord() {
    if (!lastAddedRecordId) return;
    editNote(lastAddedRecordId);
  }

  function clearRecords() {
    if (records.length === 0) {
      announce("削除する記録はありません。");
      return;
    }
    if (!window.confirm("すべての記録を削除しますか？この操作は元に戻せません。")) return;

    records = [];
    saveRecords();
    render();
    hideLastAction();
    announce("すべての記録を削除しました。");
  }

  function getPeriodBoundaries(now) {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    const mondayOffset = (now.getDay() + 6) % 7;
    startOfWeek.setDate(startOfWeek.getDate() - mondayOffset);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);

    return {
      startOfDay,
      startOfWeek,
      endOfWeek,
      startOfMonth: new Date(now.getFullYear(), now.getMonth(), 1),
      startOfYear: new Date(now.getFullYear(), 0, 1)
    };
  }

  function summarize(sourceRecords) {
    return sourceRecords.reduce((summary, record) => {
      summary.net += record.amount;
      if (record.amount < 0) summary.expense += Math.abs(record.amount);
      if (record.amount > 0) summary.saving += record.amount;
      return summary;
    }, { net: 0, expense: 0, saving: 0 });
  }

  function recordsSince(startDate) {
    const startTime = startDate.getTime();
    return records.filter((record) => Date.parse(record.createdAt) >= startTime);
  }

  function renderSummary() {
    const now = new Date();
    const periods = getPeriodBoundaries(now);
    const month = summarize(recordsSince(periods.startOfMonth));

    elements.monthNet.textContent = formatSignedAmount(month.net);
    elements.monthExpense.textContent = `${formatAmount(month.expense)}円`;
    elements.monthSaving.textContent = `${formatAmount(month.saving)}円`;
    elements.dayNet.textContent = formatSignedAmount(summarize(recordsSince(periods.startOfDay)).net);
    elements.weekNet.textContent = formatSignedAmount(summarize(recordsSince(periods.startOfWeek)).net);
    elements.yearNet.textContent = formatSignedAmount(summarize(recordsSince(periods.startOfYear)).net);
    elements.allNet.textContent = formatSignedAmount(summarize(records).net);

    elements.dayRange.textContent = formatDate(now);
    elements.weekRange.textContent = `${formatDate(periods.startOfWeek)}〜${formatDate(periods.endOfWeek)}`;
    elements.monthRange.textContent = `${formatDate(periods.startOfMonth)}〜${formatDate(now)}`;
    elements.yearRange.textContent = `${formatDate(periods.startOfYear)}〜${formatDate(now)}`;
  }

  function renderRecentRecords() {
    elements.recentRecords.replaceChildren();
    const recent = [...records]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, RECENT_LIMIT);

    elements.emptyRecords.hidden = recent.length > 0;

    for (const record of recent) {
      const item = document.createElement("li");
      item.className = `record-item ${record.amount < 0 ? "expense-record" : "saving-record"}`;
      item.dataset.id = record.id;

      const sign = document.createElement("span");
      sign.className = "record-sign";
      sign.setAttribute("aria-hidden", "true");

      const main = document.createElement("div");
      main.className = "record-main";
      const topLine = document.createElement("div");
      topLine.className = "record-topline";
      const amount = document.createElement("span");
      amount.className = `record-amount ${record.amount < 0 ? "expense-text" : "saving-text"}`;
      amount.textContent = `${formatSignedAmount(record.amount)}円`;
      const time = document.createElement("span");
      time.className = "record-time";
      time.textContent = formatRecordDate(new Date(record.createdAt));
      topLine.append(amount, time);
      main.append(topLine);

      if (record.note) {
        const note = document.createElement("p");
        note.className = "record-note";
        note.textContent = record.note;
        main.append(note);
      }

      const actions = document.createElement("div");
      actions.className = "record-actions";
      const noteButton = document.createElement("button");
      noteButton.type = "button";
      noteButton.className = "record-action";
      noteButton.dataset.action = "note";
      noteButton.textContent = record.note ? "メモ編集" : "メモ";
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "record-action delete";
      deleteButton.dataset.action = "delete";
      deleteButton.textContent = "削除";
      actions.append(noteButton, deleteButton);

      item.append(sign, main, actions);
      elements.recentRecords.append(item);
    }
  }

  function getRecentMonths(now, count) {
    const months = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      months.push(new Date(now.getFullYear(), now.getMonth() - offset, 1));
    }
    return months;
  }

  function recordsInMonth(monthStart) {
    const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    const start = monthStart.getTime();
    const end = nextMonth.getTime();
    return records.filter((record) => {
      const time = Date.parse(record.createdAt);
      return time >= start && time < end;
    });
  }

  function renderMonthlyTrend() {
    const monthData = getRecentMonths(new Date(), TREND_MONTHS).map((month) => ({
      month,
      net: summarize(recordsInMonth(month)).net
    }));
    const maxMagnitude = Math.max(1, ...monthData.map((item) => Math.abs(item.net)));
    elements.monthlyTrend.replaceChildren();

    for (const item of monthData) {
      const row = document.createElement("div");
      row.className = "trend-row";
      const month = document.createElement("span");
      month.className = "trend-month";
      month.textContent = `${item.month.getMonth() + 1}月`;
      const track = document.createElement("div");
      track.className = "trend-track";
      const bar = document.createElement("div");
      bar.className = `trend-bar ${item.net > 0 ? "positive" : item.net < 0 ? "negative" : ""}`;
      bar.style.width = `${Math.abs(item.net) / maxMagnitude * 100}%`;
      track.append(bar);
      const value = document.createElement("span");
      value.className = "trend-value";
      value.textContent = `${formatSignedAmount(item.net)}円`;
      row.append(month, track, value);
      elements.monthlyTrend.append(row);
    }
  }

  function render() {
    renderSummary();
    renderRecentRecords();
    renderMonthlyTrend();
  }

  function formatAmount(amount) {
    return numberFormat.format(amount);
  }

  function formatSignedAmount(amount) {
    return `${amount > 0 ? "+" : ""}${formatAmount(amount)}`;
  }

  function formatDate(date) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function formatRecordDate(date) {
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const isYesterday = date.getFullYear() === yesterday.getFullYear()
      && date.getMonth() === yesterday.getMonth()
      && date.getDate() === yesterday.getDate();
    const dayLabel = sameDay ? "今日" : isYesterday ? "昨日" : `${date.getMonth() + 1}/${date.getDate()}`;
    return `${dayLabel} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function announce(message) {
    elements.statusMessage.textContent = message;
  }

  function showLastAction(record) {
    elements.lastActionMessage.textContent = `${formatSignedAmount(record.amount)}円を記録しました。`;
    elements.addNoteButton.textContent = record.note ? "メモ編集" : "メモを追加";
    elements.lastAction.hidden = false;
  }

  function hideLastAction() {
    lastAddedRecordId = null;
    resetMergeWindow();
    elements.lastAction.hidden = true;
  }

  function toggleCustomEntry() {
    const willOpen = elements.customEntry.hidden;
    elements.customEntry.hidden = !willOpen;
    elements.customToggle.setAttribute("aria-expanded", String(willOpen));
    elements.customToggle.textContent = willOpen ? "その他の金額を閉じる" : "その他の金額";
    if (willOpen) elements.customAmount.focus();
  }

  function handleQuickAmountClick(event) {
    const button = event.target.closest("[data-amount]");
    if (!button) return;
    const amount = Number(button.dataset.amount);
    if (Number.isFinite(amount)) addRecord(amount);
  }

  function handleCustomSubmit(event) {
    event.preventDefault();
    const submitter = event.submitter;
    const kind = submitter?.dataset.kind;
    const rawAmount = Number(elements.customAmount.value);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0 || rawAmount > MAX_AMOUNT) {
      announce(`1〜${formatAmount(MAX_AMOUNT)}円の範囲で入力してください。`);
      elements.customAmount.focus();
      return;
    }

    const amount = Math.trunc(rawAmount) * (kind === "expense" ? -1 : 1);
    addRecord(amount, elements.customNote.value);
    elements.customEntry.reset();
  }

  function handleQuickSettingsSubmit(event) {
    event.preventDefault();
    const values = elements.quickAmountInputs.map((input) => Number(input.value));
    const normalized = normalizeQuickAmounts(values);
    if (!normalized) {
      announce(`クイック金額は1〜${formatAmount(MAX_AMOUNT)}円の異なる整数を4つ入力してください。`);
      return;
    }

    quickAmounts = normalized;
    saveQuickAmounts();
    resetMergeWindow();
    renderQuickAmounts();
    announce("クイック金額を保存しました。");
  }

  function resetQuickAmounts() {
    quickAmounts = [...DEFAULT_QUICK_AMOUNTS];
    saveQuickAmounts();
    resetMergeWindow();
    renderQuickAmounts();
    announce("クイック金額を初期値に戻しました。");
  }

  function handleRecentAction(event) {
    const button = event.target.closest("[data-action]");
    const item = event.target.closest("[data-id]");
    if (!button || !item) return;

    resetMergeWindow();
    if (button.dataset.action === "note") editNote(item.dataset.id);
    if (button.dataset.action === "delete" && deleteRecord(item.dataset.id)) {
      announce("記録を削除しました。");
    }
  }

  function createBackupPayload() {
    return {
      app: "spending-tracker",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      records
    };
  }

  function downloadFile(filename, type, text) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function timestampForFilename() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  function exportJson() {
    downloadFile(
      `spending-tracker-backup-${timestampForFilename()}.json`,
      "application/json;charset=utf-8",
      `${JSON.stringify(createBackupPayload(), null, 2)}\n`
    );
    announce("JSONバックアップを書き出しました。");
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  }

  function exportCsv() {
    const header = ["日時", "種別", "金額", "メモ"];
    const rows = [...records]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map((record) => [
        record.createdAt,
        record.amount < 0 ? "無駄遣い" : "回避",
        Math.abs(record.amount),
        record.note
      ]);
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n")}\r\n`;
    downloadFile(`spending-tracker-${timestampForFilename()}.csv`, "text/csv;charset=utf-8", csv);
    announce("CSVを書き出しました。");
  }

  async function importBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.app !== "spending-tracker" || parsed?.version !== BACKUP_VERSION || !Array.isArray(parsed.records)) {
        throw new Error("対応していないバックアップ形式です。");
      }
      const imported = parsed.records.map(normalizeRecord).filter(Boolean);
      if (imported.length !== parsed.records.length) {
        throw new Error("不正な記録が含まれています。");
      }
      if (!window.confirm(`現在の${records.length}件を、バックアップの${imported.length}件で置き換えますか？`)) return;

      const seenIds = new Set();
      records = imported.map((record) => {
        if (!seenIds.has(record.id)) {
          seenIds.add(record.id);
          return record;
        }
        const replacement = { ...record, id: createId() };
        seenIds.add(replacement.id);
        return replacement;
      });
      hideLastAction();
      saveRecords();
      render();
      announce(`${records.length}件の記録を復元しました。`);
    } catch (error) {
      console.warn("バックアップを復元できませんでした。", error);
      announce(error instanceof Error ? error.message : "バックアップを復元できませんでした。");
    } finally {
      elements.importFile.value = "";
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((error) => {
        console.warn("Service Workerを登録できませんでした。", error);
      });
    });
  }

  elements.amountButtons.addEventListener("click", handleQuickAmountClick);
  elements.customToggle.addEventListener("click", toggleCustomEntry);
  elements.customEntry.addEventListener("submit", handleCustomSubmit);
  elements.quickSettings.addEventListener("submit", handleQuickSettingsSubmit);
  elements.resetQuickAmountsButton.addEventListener("click", resetQuickAmounts);
  elements.undoButton.addEventListener("click", undoLastRecord);
  elements.addNoteButton.addEventListener("click", addNoteToLastRecord);
  elements.recentRecords.addEventListener("click", handleRecentAction);
  elements.exportJsonButton.addEventListener("click", exportJson);
  elements.exportCsvButton.addEventListener("click", exportCsv);
  elements.importButton.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", () => {
    const [file] = elements.importFile.files;
    if (file) importBackup(file);
  });
  elements.resetButton.addEventListener("click", clearRecords);

  renderQuickAmounts();
  render();
  registerServiceWorker();
})();
