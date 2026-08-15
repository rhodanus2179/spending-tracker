(() => {
  "use strict";

  const STORAGE_KEY = "spending-tracker.records.v3";
  const MERGE_WINDOW_MS = 2_000;
  const MAX_ACTIVE_EFFECTS = 2;
  const PARTICLE_COUNT = 28;

  const elements = {
    amountButtons: document.querySelector("#amountButtons"),
    customEntry: document.querySelector("#customEntry"),
    entryCard: document.querySelector(".entry-card-primary"),
    effectLayer: document.querySelector("#effectLayer"),
    monthSaving: document.querySelector("#monthSaving")
  };

  if (!elements.amountButtons || !elements.customEntry || !elements.effectLayer || !elements.monthSaving) return;

  const pendingEffects = new Map();
  const activeEffects = [];
  let inputSnapshot = null;
  let inputContext = null;

  function readRecordMap() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(stored)) return new Map();
      return new Map(stored
        .filter((record) => record && typeof record.id === "string" && Number.isFinite(Number(record.amount)))
        .map((record) => [record.id, { id: record.id, amount: Math.trunc(Number(record.amount)) }]));
    } catch (error) {
      console.warn("回避成功エフェクト用の記録を読み込めませんでした。", error);
      return new Map();
    }
  }

  function centerOf(element) {
    const fallback = { x: window.innerWidth / 2, y: Math.min(window.innerHeight * 0.32, 260) };
    if (!(element instanceof Element)) return fallback;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return fallback;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }

  function getEffectOrigin(context, record) {
    if (context?.inputAmount > 0 && record.amount > 0) return centerOf(context.sourceElement);
    return centerOf(elements.entryCard);
  }

  function cancelPendingEffect(recordId) {
    const pending = pendingEffects.get(recordId);
    if (!pending) return;
    clearTimeout(pending.timerId);
    pendingEffects.delete(recordId);
  }

  function scheduleFinalizeEffect(record, context) {
    cancelPendingEffect(record.id);
    const origin = getEffectOrigin(context, record);
    const timerId = window.setTimeout(() => finalizeRecordEffect(record.id, origin), MERGE_WINDOW_MS);
    pendingEffects.set(record.id, { timerId, origin });
  }

  function finalizeRecordEffect(recordId, origin) {
    pendingEffects.delete(recordId);
    const record = readRecordMap().get(recordId);
    if (!record || record.amount <= 0) return;
    playSavingSuccessEffect(record.amount, origin);
  }

  function beginInput(sourceElement, inputAmount) {
    inputSnapshot = readRecordMap();
    inputContext = { sourceElement, inputAmount };
  }

  function finishInput() {
    if (!inputSnapshot) return;
    const before = inputSnapshot;
    const context = inputContext;
    inputSnapshot = null;
    inputContext = null;

    const after = readRecordMap();
    for (const [id] of before) {
      if (!after.has(id)) cancelPendingEffect(id);
    }

    for (const [id, record] of after) {
      const previous = before.get(id);
      if (!previous || previous.amount !== record.amount) {
        scheduleFinalizeEffect(record, context);
      }
    }
  }

  function handleQuickCapture(event) {
    const button = event.target.closest("[data-amount]");
    if (!button) return;
    const amount = Number(button.dataset.amount);
    if (!Number.isFinite(amount)) return;
    beginInput(button, amount);
  }

  function handleQuickBubble(event) {
    if (!event.target.closest("[data-amount]")) return;
    finishInput();
  }

  function handleCustomCapture(event) {
    const submitter = event.submitter;
    if (!(submitter instanceof HTMLElement)) return;
    const rawAmount = Number(document.querySelector("#customAmount")?.value);
    const kind = submitter.dataset.kind;
    if (!Number.isFinite(rawAmount) || rawAmount <= 0 || (kind !== "expense" && kind !== "saving")) return;
    const signedAmount = Math.trunc(rawAmount) * (kind === "expense" ? -1 : 1);
    beginInput(submitter, signedAmount);
  }

  function handleCustomBubble() {
    finishInput();
  }

  function removeEffectNode(node) {
    const index = activeEffects.indexOf(node);
    if (index >= 0) activeEffects.splice(index, 1);
    node.remove();
  }

  function registerEffectNode(node) {
    activeEffects.push(node);
    while (activeEffects.length > MAX_ACTIVE_EFFECTS) {
      const oldest = activeEffects.shift();
      oldest?.remove();
    }
  }

  function createSuccessBurst(amount, origin) {
    const root = document.createElement("div");
    root.className = "saving-success";
    root.style.setProperty("--origin-x", `${origin.x}px`);
    root.style.setProperty("--origin-y", `${origin.y}px`);

    const message = document.createElement("div");
    message.className = "saving-success-message";

    const amountElement = document.createElement("strong");
    amountElement.className = "saving-success-amount";
    amountElement.textContent = `＋${new Intl.NumberFormat("ja-JP").format(amount)}円`;

    const label = document.createElement("span");
    label.className = "saving-success-label";
    label.textContent = "回避成功！";
    message.append(amountElement, label);
    root.append(message);

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const spread = (index + 0.5) / PARTICLE_COUNT;
      const angle = -Math.PI + Math.PI * spread;
      const distance = 78 + (index % 6) * 11;
      const particle = document.createElement("span");
      particle.className = `saving-particle saving-particle-${index % 4}`;
      particle.style.setProperty("--particle-x", `${Math.cos(angle) * distance}px`);
      particle.style.setProperty("--particle-y", `${Math.sin(angle) * distance}px`);
      particle.style.setProperty("--particle-fall", `${108 + (index % 5) * 18}px`);
      particle.style.setProperty("--particle-spin", `${(index % 2 === 0 ? 1 : -1) * (260 + (index % 6) * 55)}deg`);
      particle.style.setProperty("--particle-delay", `${(index % 7) * 14}ms`);
      root.append(particle);
    }

    elements.effectLayer.append(root);
    registerEffectNode(root);
    window.setTimeout(() => removeEffectNode(root), 1_500);
  }

  function createSpark(origin, target) {
    const spark = document.createElement("span");
    spark.className = "saving-spark";
    spark.style.setProperty("--spark-start-x", `${origin.x}px`);
    spark.style.setProperty("--spark-start-y", `${origin.y}px`);
    spark.style.setProperty("--spark-x", `${target.x - origin.x}px`);
    spark.style.setProperty("--spark-y", `${target.y - origin.y}px`);
    elements.effectLayer.append(spark);
    window.setTimeout(() => spark.remove(), 1_200);
  }

  function pulseMonthlySaving(amount, target) {
    const targetContainer = elements.monthSaving.closest("p") ?? elements.monthSaving;
    targetContainer.classList.remove("saving-summary-pulse");
    void targetContainer.getBoundingClientRect();
    targetContainer.classList.add("saving-summary-pulse");
    window.setTimeout(() => targetContainer.classList.remove("saving-summary-pulse"), 700);

    const delta = document.createElement("span");
    delta.className = "saving-delta";
    delta.textContent = `＋${new Intl.NumberFormat("ja-JP").format(amount)}`;
    delta.style.setProperty("--delta-x", `${target.x}px`);
    delta.style.setProperty("--delta-y", `${target.y}px`);
    elements.effectLayer.append(delta);
    window.setTimeout(() => delta.remove(), 900);
  }

  function playSavingSuccessEffect(amount, origin) {
    const target = centerOf(elements.monthSaving);
    createSuccessBurst(amount, origin);
    createSpark(origin, target);
    window.setTimeout(() => pulseMonthlySaving(amount, target), 760);
  }

  elements.amountButtons.addEventListener("click", handleQuickCapture, { capture: true });
  elements.amountButtons.addEventListener("click", handleQuickBubble);
  elements.customEntry.addEventListener("submit", handleCustomCapture, { capture: true });
  elements.customEntry.addEventListener("submit", handleCustomBubble);
})();
