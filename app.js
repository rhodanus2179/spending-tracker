(() => {
  "use strict";

  const STORAGE_KEY = "spending-tracker.records.v2";
  const numberFormat = new Intl.NumberFormat("ja-JP");

  const elements = {
    balance: document.querySelector("#balance"),
    dayTotal: document.querySelector("#dayTotal"),
    weekTotal: document.querySelector("#weekTotal"),
    monthTotal: document.querySelector("#monthTotal"),
    yearTotal: document.querySelector("#yearTotal"),
    dayRange: document.querySelector("#dayRange"),
    weekRange: document.querySelector("#weekRange"),
    monthRange: document.querySelector("#monthRange"),
    yearRange: document.querySelector("#yearRange"),
    amountButtons: document.querySelector("#amountButtons"),
    resetButton: document.querySelector("#resetButton"),
    statusMessage: document.querySelector("#statusMessage")
  };

  let records = loadRecords();

  function loadRecords() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(stored)) return [];

      return stored.filter((record) => {
        return Number.isFinite(record?.amount) && !Number.isNaN(Date.parse(record?.createdAt));
      });
    } catch (error) {
      console.warn("保存データを読み込めませんでした。", error);
      return [];
    }
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  function addRecord(amount) {
    records.push({
      amount,
      createdAt: new Date().toISOString()
    });
    saveRecords();
    render();
    announce(`${formatSignedAmount(amount)}円を記録しました。`);
  }

  function clearRecords() {
    if (records.length === 0) {
      announce("削除する記録はありません。");
      return;
    }

    if (!window.confirm("すべての記録を削除しますか？この操作は元に戻せません。")) {
      return;
    }

    records = [];
    saveRecords();
    render();
    announce("すべての記録を削除しました。");
  }

  function sumRecords(startDate) {
    const startTime = startDate.getTime();
    return records.reduce((total, record) => {
      return Date.parse(record.createdAt) >= startTime ? total + record.amount : total;
    }, 0);
  }

  function sumAllRecords() {
    return records.reduce((total, record) => total + record.amount, 0);
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

  function render() {
    const now = new Date();
    const periods = getPeriodBoundaries(now);

    elements.balance.textContent = formatAmount(sumAllRecords());
    elements.dayTotal.textContent = formatAmount(sumRecords(periods.startOfDay));
    elements.weekTotal.textContent = formatAmount(sumRecords(periods.startOfWeek));
    elements.monthTotal.textContent = formatAmount(sumRecords(periods.startOfMonth));
    elements.yearTotal.textContent = formatAmount(sumRecords(periods.startOfYear));

    elements.dayRange.textContent = formatDate(now);
    elements.weekRange.textContent = `${formatDate(periods.startOfWeek)}〜${formatDate(periods.endOfWeek)}`;
    elements.monthRange.textContent = `${formatDate(periods.startOfMonth)}〜${formatDate(now)}`;
    elements.yearRange.textContent = `${formatDate(periods.startOfYear)}〜${formatDate(now)}`;
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

  function announce(message) {
    elements.statusMessage.textContent = message;
  }

  function handleAmountClick(event) {
    const button = event.target.closest("[data-amount]");
    if (!button) return;

    const amount = Number(button.dataset.amount);
    if (!Number.isFinite(amount)) return;
    addRecord(amount);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch((error) => {
        console.warn("Service Workerを登録できませんでした。", error);
      });
    });
  }

  elements.amountButtons.addEventListener("click", handleAmountClick);
  elements.resetButton.addEventListener("click", clearRecords);

  render();
  registerServiceWorker();
})();
