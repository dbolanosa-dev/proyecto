"use strict";

const ALERT_DAYS_KEY = "mi-pulperia-alert-days-v1";
const DEFAULT_ALERT_DAYS = 30;
const ALLOWED_ALERT_DAYS = [30, 60, 90, 120];
const EXPIRY_DISCOUNT_TIERS = [
  { daysLeft: 10, percentage: 20 },
  { daysLeft: 30, percentage: 10 },
];
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LOW_STOCK_LIMIT = 3;

const elements = {
  today: document.querySelector("#today-label"),
  productCount: document.querySelector("#product-count"),
  expiringCount: document.querySelector("#expiring-count"),
  expiredCount: document.querySelector("#expired-count"),
  expiringSummaryLabel: document.querySelector("#expiring-summary-label"),
  salesToday: document.querySelector("#sales-today"),
  monthlySalesTotal: document.querySelector("#monthly-sales-total"),
  monthlySalesPeriod: document.querySelector("#monthly-sales-period"),
  monthlySalesChart: document.querySelector("#monthly-sales-chart"),
  monthlySalesChange: document.querySelector("#monthly-sales-change"),
  monthlySalesChangeDetail: document.querySelector("#monthly-sales-change-detail"),
  monthlyGainsTotal: document.querySelector("#monthly-gains-total"),
  monthlyLossesTotal: document.querySelector("#monthly-losses-total"),
  monthlyEstimatedProfit: document.querySelector("#monthly-estimated-profit"),
  monthlyTopProducts: document.querySelector("#monthly-top-products"),
  monthlyTopProductsEmpty: document.querySelector("#monthly-top-products-empty"),
  alertDays: document.querySelector("#alert-days"),
  expiringAlertCount: document.querySelector("#expiring-alert-count"),
  expiringAlertList: document.querySelector("#expiring-alert-list"),
  lowStockAlertCount: document.querySelector("#low-stock-alert-count"),
  lowStockAlertList: document.querySelector("#low-stock-alert-list"),
  inventoryBody: document.querySelector("#inventory-body"),
  movementsBody: document.querySelector("#movements-body"),
  emptyState: document.querySelector("#empty-state"),
  emptyMovements: document.querySelector("#empty-movements"),
  noResults: document.querySelector("#no-results"),
  search: document.querySelector("#search-input"),
  productDialog: document.querySelector("#product-dialog"),
  movementDialog: document.querySelector("#movement-dialog"),
  cartDialog: document.querySelector("#cart-dialog"),
  offerDialog: document.querySelector("#offer-dialog"),
  productForm: document.querySelector("#product-form"),
  movementForm: document.querySelector("#movement-form"),
  cartForm: document.querySelector("#cart-form"),
  offerForm: document.querySelector("#offer-form"),
  productError: document.querySelector("#product-error"),
  movementError: document.querySelector("#movement-error"),
  offerError: document.querySelector("#offer-error"),
  movementProductLabel: document.querySelector("#movement-product-label"),
  movementPriceLabel: document.querySelector("#movement-price-label"),
  movementPersonField: document.querySelector("#movement-person-field"),
  movementPriceHint: document.querySelector("#movement-price-hint"),
  cartSearch: document.querySelector("#cart-search"),
  cartMenu: document.querySelector("#cart-menu"),
  cartMenuEmpty: document.querySelector("#cart-menu-empty"),
  cartItems: document.querySelector("#cart-items"),
  cartEmpty: document.querySelector("#cart-empty"),
  cartTotal: document.querySelector("#cart-total"),
  cartError: document.querySelector("#cart-error"),
  checkoutButton: document.querySelector("#checkout-button"),
  offerProductLabel: document.querySelector("#offer-product-label"),
  offerDialogTitle: document.querySelector("#offer-dialog-title"),
  removeOfferButton: document.querySelector("#remove-offer-button"),
  offersList: document.querySelector("#offers-list"),
  offerCount: document.querySelector("#offer-count"),
  offersEmpty: document.querySelector("#offers-empty"),
  catalogDialog: document.querySelector("#catalog-dialog"),
  catalogSearch: document.querySelector("#catalog-search"),
  catalogCategory: document.querySelector("#catalog-category"),
  catalogList: document.querySelector("#catalog-list"),
  catalogCount: document.querySelector("#catalog-count"),
  catalogEmpty: document.querySelector("#catalog-empty"),
  expiryDate: document.querySelector("#expiry-date"),
  noExpiry: document.querySelector("#no-expiry"),
  scannerDialog: document.querySelector("#scanner-dialog"),
  scannerVideo: document.querySelector("#scanner-video"),
  scannerPlaceholder: document.querySelector("#scanner-placeholder"),
  scannerStatus: document.querySelector("#scanner-status"),
  scannerManualInput: document.querySelector("#scanner-manual-input"),
  scannerManualForm: document.querySelector("#scanner-manual-form"),
  scannerStartButton: document.querySelector("#scanner-start-button"),
  importInput: document.querySelector("#import-input"),
};

let inventory = { products: [], movements: [] };
let inventoryVersion = 0;
let saveQueue = Promise.resolve();
let selectedFilter = "all";
let alertDays = loadAlertDays();
let scannerStream = null;
let scannerAnimationFrame = null;
let scannerMode = "lookup";
let scannerTarget = null;
let scannerReturnDialog = null;
let scannerRequestId = 0;
let productDraft = null;
let cartItems = [];

function loadAlertDays() {
  try {
    const storedValue = Number(localStorage.getItem(ALERT_DAYS_KEY));
    return ALLOWED_ALERT_DAYS.includes(storedValue) ? storedValue : DEFAULT_ALERT_DAYS;
  } catch (error) {
    console.error("No se pudo cargar la anticipación de avisos.", error);
    return DEFAULT_ALERT_DAYS;
  }
}

function formatQuantity(value) {
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 3 }).format(value);
}

function saveAlertDays(value) {
  try {
    localStorage.setItem(ALERT_DAYS_KEY, String(value));
    alertDays = value;
    return true;
  } catch (error) {
    console.error("No se pudo guardar la anticipación de avisos.", error);
    window.alert("No se pudo guardar esta preferencia en el navegador.");
    return false;
  }
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseLocalDate(value);
  return localDateString(date) === value;
}

function isValidDateTime(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) &&
    Number.isFinite(new Date(value).getTime());
}

function isValidInventory(value) {
  if (!value || !Array.isArray(value.products) || !Array.isArray(value.movements)) return false;
  const validProduct = (product) =>
    product && typeof product.id === "string" && typeof product.name === "string" &&
    typeof product.category === "string" &&
    (product.barcode == null || typeof product.barcode === "string") &&
    isValidDate(product.entryDate) &&
    (product.expiryDate === "" || isValidDate(product.expiryDate)) &&
    typeof product.createdAt === "string" &&
    Number.isFinite(product.quantity) && product.quantity > 0 &&
    Number.isFinite(product.remainingQuantity) && product.remainingQuantity >= 0 &&
    product.remainingQuantity <= product.quantity &&
    Number.isFinite(product.unitCost) && product.unitCost >= 0 &&
    Number.isFinite(product.unitPrice) && product.unitPrice >= 0 &&
    ((product.offerPrice == null && product.offerEndsAt == null) ||
      (Number.isFinite(product.offerPrice) && product.offerPrice >= 0 &&
        product.offerPrice < product.unitPrice && isValidDateTime(product.offerEndsAt)));
  const validMovement = (movement) =>
    movement && typeof movement.id === "string" &&
    typeof movement.productId === "string" && typeof movement.productName === "string" &&
    (movement.type === "sale" || movement.type === "consumption") &&
    isValidDate(movement.date) && typeof movement.createdAt === "string" &&
    Number.isFinite(movement.quantity) && movement.quantity > 0 &&
    Number.isFinite(movement.unitPrice) && movement.unitPrice >= 0 &&
    Number.isFinite(movement.total) && movement.total >= 0 &&
    (movement.unitCost == null ||
      (Number.isFinite(movement.unitCost) && movement.unitCost >= 0)) &&
    (movement.personName == null ||
      (typeof movement.personName === "string" && movement.personName.length <= 80)) &&
    (movement.orderId == null ||
      (typeof movement.orderId === "string" && movement.orderId.length > 0 &&
        movement.orderId.length <= 80));
  return value.products.every(validProduct) && value.movements.every(validMovement);
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateTimeValue(date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parseLocalDate(value));
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    credentials: "same-origin",
    ...options,
  });
  const result = await response.json();
  if (response.status === 401) {
    window.location.replace("/login");
    throw new Error("La sesión terminó. Inicie sesión de nuevo.");
  }
  if (!response.ok) {
    if (response.status === 409) {
      window.alert(`${result.error} Revise los datos recientes antes de volver a registrar el cambio.`);
      window.location.reload();
    }
    throw new Error(result.error || "No se pudo completar la solicitud.");
  }
  return result;
}

async function loadInventory() {
  const result = await apiRequest("inventory");
  if (!isValidInventory(result.inventory) || !Number.isSafeInteger(result.version) || result.version < 0) {
    throw new Error("El servidor devolvió un inventario con un formato no válido.");
  }
  inventory = result.inventory;
  inventoryVersion = result.version;
}

function saveInventory() {
  const snapshot = structuredClone(inventory);
  const save = saveQueue.then(async () => {
    const result = await apiRequest("inventory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventory: snapshot, version: inventoryVersion }),
    });
    inventoryVersion = result.version;
  });
  saveQueue = save.catch(() => {});
  return save;
}

function parseNumericInput(value) {
  if (value === null || value === undefined) return Number.NaN;
  const text = String(value).trim();
  if (!text) return Number.NaN;

  let normalized = text.replace(/\s+/g, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  const result = Number(normalized);
  return Number.isFinite(result) ? result : Number.NaN;
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function daysUntilExpiry(product) {
  if (!product.expiryDate) return Number.POSITIVE_INFINITY;
  const today = parseLocalDate(localDateString());
  return Math.round((parseLocalDate(product.expiryDate) - today) / DAY_IN_MS);
}

function expiryDiscount(product) {
  const daysLeft = daysUntilExpiry(product);
  if (daysLeft < 0 || product.remainingQuantity <= 0 || product.unitPrice <= 0) {
    return null;
  }
  const tier = EXPIRY_DISCOUNT_TIERS.find((item) => daysLeft <= item.daysLeft);
  if (!tier) return null;
  const expiryEnd = parseLocalDate(product.expiryDate);
  expiryEnd.setHours(23, 59, 59, 999);
  return {
    type: "expiry",
    percentage: tier.percentage,
    price: product.unitPrice * (1 - tier.percentage / 100),
    endsAt: expiryEnd,
  };
}

function activeOffer(product, now = Date.now()) {
  if (
    product.remainingQuantity <= 0 ||
    daysUntilExpiry(product) < 0 ||
    !Number.isFinite(product.offerPrice) ||
    product.offerPrice < 0 ||
    product.offerPrice >= product.unitPrice ||
    !isValidDateTime(product.offerEndsAt)
  ) {
    return false;
  }
  return new Date(product.offerEndsAt).getTime() > now;
}

function currentPromotion(product) {
  const promotions = [];
  if (activeOffer(product)) {
    promotions.push({
      type: "offer",
      percentage: Math.round((1 - product.offerPrice / product.unitPrice) * 100),
      price: product.offerPrice,
      endsAt: new Date(product.offerEndsAt),
    });
  }
  const nearExpiryDiscount = expiryDiscount(product);
  if (nearExpiryDiscount) promotions.push(nearExpiryDiscount);
  return promotions.sort((first, second) => first.price - second.price)[0] ?? null;
}

function remainingOfferTime(value) {
  const totalMinutes = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60_000));
  if (totalMinutes === 0) return "Menos de 1 minuto";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `Termina en ${days} d ${hours} h`;
  if (hours > 0) return `Termina en ${hours} h ${minutes} min`;
  return `Termina en ${minutes} min`;
}

function expiryStatus(product) {
  if (product.remainingQuantity <= 0) return { label: "Agotado", className: "status-empty" };
  const days = daysUntilExpiry(product);
  if (days < 0) return { label: "Vencido", className: "status-expired" };
  if (days <= alertDays) return { label: days === 0 ? "Vence hoy" : `Vence en ${days} d`, className: "status-soon" };
  if (product.remainingQuantity <= LOW_STOCK_LIMIT) return { label: "Pocas existencias", className: "status-low" };
  return { label: "En buen estado", className: "status-ok" };
}

function setError(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

function renderSummary() {
  const stockedProducts = inventory.products.filter((product) => product.remainingQuantity > 0);
  elements.productCount.textContent = stockedProducts.length;
  elements.expiringCount.textContent = stockedProducts.filter((product) => {
    const days = daysUntilExpiry(product);
    return days >= 0 && days <= alertDays;
  }).length;
  elements.expiringSummaryLabel.textContent = `Lotes por vencer en ${alertDays} días`;
  elements.expiredCount.textContent = stockedProducts.filter((product) => daysUntilExpiry(product) < 0).length;
  const today = localDateString();
  const sales = inventory.movements
    .filter((movement) => movement.type === "sale" && movement.date === today)
    .reduce((total, movement) => total + movement.total, 0);
  elements.salesToday.textContent = formatMoney(sales);
  renderMonthlySales();
}

function renderMonthlySales() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil(daysInMonth / 7);
  const weeklySales = Array.from({ length: weekCount }, () => 0);
  const weeklyGains = Array.from({ length: weekCount }, () => 0);
  const weeklyLosses = Array.from({ length: weekCount }, () => 0);
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const previousMonthDate = new Date(year, month - 1, 1);
  const previousMonthPrefix =
    `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}-`;
  const previousMonthName = new Intl.DateTimeFormat("es-CR", {
    month: "long",
    year: "numeric",
  }).format(previousMonthDate);
  const monthName = new Intl.DateTimeFormat("es-CR", { month: "long" }).format(now);
  elements.monthlySalesPeriod.textContent = `1–${daysInMonth} de ${monthName} de ${year}`;

  let previousMonthSales = 0;
  let estimatedProfit = 0;
  const productsById = new Map(inventory.products.map((product) => [product.id, product]));
  const topProducts = new Map();
  for (const movement of inventory.movements) {
    if (movement.type === "sale" && movement.date.startsWith(previousMonthPrefix)) {
      previousMonthSales += movement.total;
      continue;
    }
    if (!movement.date.startsWith(monthPrefix)) continue;
    const day = Number(movement.date.slice(8, 10));
    const weekIndex = Math.floor((day - 1) / 7);
    const product = productsById.get(movement.productId);
    const unitCost = Number.isFinite(movement.unitCost)
      ? movement.unitCost
      : product?.unitCost ?? 0;
    const cost = unitCost * movement.quantity;
    if (movement.type === "sale") {
      const grossProfit = movement.total - cost;
      estimatedProfit += grossProfit;
      if (Number.isInteger(day) && weekIndex >= 0 && weekIndex < weeklySales.length) {
        weeklySales[weekIndex] += movement.total;
        weeklyGains[weekIndex] += Math.max(grossProfit, 0);
        weeklyLosses[weekIndex] += Math.max(-grossProfit, 0);
      }
    } else {
      estimatedProfit -= cost;
      if (Number.isInteger(day) && weekIndex >= 0 && weekIndex < weeklyLosses.length) {
        weeklyLosses[weekIndex] += cost;
      }
    }
    if (movement.type !== "sale") continue;
    const summary = topProducts.get(movement.productId) ?? {
      name: movement.productName,
      quantity: 0,
      revenue: 0,
    };
    summary.quantity += movement.quantity;
    summary.revenue += movement.total;
    topProducts.set(movement.productId, summary);
  }

  const monthlyTotal = weeklySales.reduce((total, amount) => total + amount, 0);
  const monthlyGains = weeklyGains.reduce((total, amount) => total + amount, 0);
  const monthlyLosses = weeklyLosses.reduce((total, amount) => total + amount, 0);
  const maxFinancialAmount = Math.max(...weeklyGains, ...weeklyLosses, 0);
  const formatMonthDay = (day) =>
    new Intl.DateTimeFormat("es-CR", { day: "numeric", month: "short" })
      .format(new Date(year, month, day));
  elements.monthlySalesTotal.textContent = formatMoney(monthlyTotal);
  elements.monthlyGainsTotal.textContent = formatMoney(monthlyGains);
  elements.monthlyLossesTotal.textContent = formatMoney(monthlyLosses);
  elements.monthlyEstimatedProfit.textContent = formatMoney(estimatedProfit);
  elements.monthlyEstimatedProfit.classList.toggle("is-positive", estimatedProfit > 0);
  elements.monthlyEstimatedProfit.classList.toggle("is-negative", estimatedProfit < 0);

  const change = monthlyTotal - previousMonthSales;
  const percentageChange = previousMonthSales === 0
    ? null
    : (change / previousMonthSales) * 100;
  elements.monthlySalesChange.textContent =
    `${change > 0 ? "+" : change < 0 ? "−" : ""}${formatMoney(Math.abs(change))}`;
  elements.monthlySalesChange.classList.toggle("is-positive", change > 0);
  elements.monthlySalesChange.classList.toggle("is-negative", change < 0);
  elements.monthlySalesChangeDetail.textContent = previousMonthSales === 0
    ? monthlyTotal > 0 ? `Sin ventas en ${previousMonthName}` : `Sin cambios vs. ${previousMonthName}`
    : `${percentageChange > 0 ? "+" : ""}${percentageChange.toLocaleString("es-CR", {
      maximumFractionDigits: 1,
    })}% vs. ${previousMonthName}`;

  const bestSellers = [...topProducts.values()]
    .sort((first, second) => second.quantity - first.quantity || second.revenue - first.revenue)
    .slice(0, 5);
  elements.monthlyTopProducts.replaceChildren();
  elements.monthlyTopProductsEmpty.hidden = bestSellers.length > 0;
  for (const [index, product] of bestSellers.entries()) {
    const item = document.createElement("li");
    const rank = document.createElement("span");
    rank.className = "top-product-rank";
    rank.textContent = String(index + 1);
    const name = document.createElement("span");
    name.className = "top-product-name";
    name.textContent = product.name;
    const quantity = document.createElement("span");
    quantity.className = "top-product-quantity";
    quantity.textContent = `${formatQuantity(product.quantity)} ud.`;
    const revenue = document.createElement("strong");
    revenue.className = "top-product-revenue";
    revenue.textContent = formatMoney(product.revenue);
    item.append(rank, name, quantity, revenue);
    elements.monthlyTopProducts.append(item);
  }

  renderMonthlyFinancialLines({
    chart: elements.monthlySalesChart,
    gains: weeklyGains,
    losses: weeklyLosses,
    maxAmount: maxFinancialAmount,
    weekCount,
    daysInMonth,
    formatMonthDay,
    monthName,
    year,
  });
}

function renderMonthlyFinancialLines({
  chart,
  gains,
  losses,
  maxAmount,
  weekCount,
  daysInMonth,
  formatMonthDay,
  monthName,
  year,
}) {
  const namespace = "http://www.w3.org/2000/svg";
  const width = 800;
  const height = 280;
  const left = 76;
  const right = 24;
  const top = 24;
  const bottom = 232;
  const plotWidth = width - left - right;
  const plotHeight = bottom - top;
  const scaleMaximum = maxAmount > 0 ? maxAmount * 1.12 : 1;
  const x = (index) => weekCount === 1
    ? left + plotWidth / 2
    : left + (plotWidth * index) / (weekCount - 1);
  const y = (amount) => bottom - (amount / scaleMaximum) * plotHeight;
  const svg = document.createElementNS(namespace, "svg");
  svg.classList.add("monthly-sales-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Gráfica lineal de ganancias y pérdidas por semana de ${monthName} de ${year}.`,
  );

  for (let tick = 0; tick <= 4; tick += 1) {
    const tickY = top + (plotHeight * tick) / 4;
    const value = scaleMaximum * (1 - tick / 4);
    const gridLine = document.createElementNS(namespace, "line");
    gridLine.classList.add("monthly-sales-grid");
    gridLine.setAttribute("x1", String(left));
    gridLine.setAttribute("x2", String(width - right));
    gridLine.setAttribute("y1", String(tickY));
    gridLine.setAttribute("y2", String(tickY));
    svg.append(gridLine);

    const tickLabel = document.createElementNS(namespace, "text");
    tickLabel.classList.add("monthly-sales-axis-label");
    tickLabel.setAttribute("x", String(left - 10));
    tickLabel.setAttribute("y", String(tickY + 4));
    tickLabel.setAttribute("text-anchor", "end");
    tickLabel.textContent = formatCompactMoney(value);
    svg.append(tickLabel);
  }

  const xLabelY = bottom + 34;
  for (let index = 0; index < weekCount; index += 1) {
    const startDay = index * 7 + 1;
    const endDay = Math.min(startDay + 6, daysInMonth);
    const label = document.createElementNS(namespace, "text");
    label.classList.add("monthly-sales-axis-label", "monthly-sales-week-label");
    label.setAttribute("x", String(x(index)));
    label.setAttribute("y", String(xLabelY));
    label.setAttribute("text-anchor", "middle");
    label.textContent = `${formatMonthDay(startDay)}–${formatMonthDay(endDay)}`;
    svg.append(label);
  }

  for (const [values, series, label] of [
    [gains, "gain", "Ganancia bruta"],
    [losses, "loss", "Pérdidas y merma"],
  ]) {
    const line = document.createElementNS(namespace, "polyline");
    line.classList.add("monthly-sales-line", `is-${series}`);
    line.setAttribute(
      "points",
      values.map((value, index) => `${x(index)},${y(value)}`).join(" "),
    );
    svg.append(line);

    for (let index = 0; index < values.length; index += 1) {
      const point = document.createElementNS(namespace, "circle");
      point.classList.add("monthly-sales-point", `is-${series}`);
      point.setAttribute("cx", String(x(index)));
      point.setAttribute("cy", String(y(values[index])));
      point.setAttribute("r", "5");
      const title = document.createElementNS(namespace, "title");
      title.textContent = `${label}, semana ${index + 1}: ${formatMoney(values[index])}`;
      point.append(title);
      svg.append(point);
    }
  }

  chart.replaceChildren(svg);
}

function formatCompactMoney(value) {
  return new Intl.NumberFormat("es-CR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function renderAlerts() {
  const stockedProducts = inventory.products.filter((product) => product.remainingQuantity > 0);
  const expiringProducts = stockedProducts
    .filter((product) => {
      const days = daysUntilExpiry(product);
      return days >= 0 && days <= alertDays;
    })
    .sort((first, second) => first.expiryDate.localeCompare(second.expiryDate));
  const lowStockProducts = stockedProducts
    .filter((product) => product.remainingQuantity <= LOW_STOCK_LIMIT)
    .sort((first, second) => first.remainingQuantity - second.remainingQuantity);

  elements.expiringAlertCount.textContent = `${expiringProducts.length} ${expiringProducts.length === 1 ? "lote" : "lotes"}`;
  elements.lowStockAlertCount.textContent = `${lowStockProducts.length} ${lowStockProducts.length === 1 ? "lote" : "lotes"}`;
  renderAlertList(elements.expiringAlertList, expiringProducts, (product) => {
    const days = daysUntilExpiry(product);
    const expiry = days === 0 ? "Vence hoy" : days === 1 ? "Vence mañana" : `Vence en ${days} días`;
    return `${expiry} · ${formatQuantity(product.remainingQuantity)} ud.`;
  }, "No hay lotes próximos a vencer.");
  renderAlertList(elements.lowStockAlertList, lowStockProducts, (product) =>
    `${formatQuantity(product.remainingQuantity)} de ${formatQuantity(product.quantity)} ud.`, "No hay lotes con pocas existencias.");
}

function renderOffers() {
  const offers = inventory.products
    .map((product) => ({ product, promotion: currentPromotion(product) }))
    .filter(({ promotion }) => promotion)
    .sort((first, second) => first.promotion.endsAt - second.promotion.endsAt);
  elements.offerCount.textContent = offers.length;
  elements.offersEmpty.hidden = offers.length > 0;
  elements.offersList.replaceChildren();

  for (const { product, promotion } of offers) {
    const card = document.createElement("article");
    card.className = promotion.type === "expiry"
      ? "offer-card offer-card-expiry"
      : "offer-card";

    const top = document.createElement("div");
    top.className = "offer-card-top";
    const name = document.createElement("span");
    name.className = "offer-product-name";
    name.textContent = product.name;
    const badge = document.createElement("span");
    badge.className = promotion.type === "expiry"
      ? "offer-discount offer-expiry-discount"
      : "offer-discount";
    badge.textContent = promotion.type === "expiry"
      ? `${promotion.percentage}% por vencer`
      : `${promotion.percentage}% menos`;
    top.append(name, badge);

    const prices = document.createElement("div");
    prices.className = "offer-prices";
    const offerPriceGroup = document.createElement("div");
    offerPriceGroup.className = "offer-price-group";
    const offerPriceLabel = document.createElement("span");
    offerPriceLabel.className = "offer-price-label";
    offerPriceLabel.textContent = "Ahora";
    const offerPrice = document.createElement("span");
    offerPrice.className = "offer-price";
    offerPrice.textContent = formatMoney(promotion.price);
    offerPriceGroup.append(offerPriceLabel, offerPrice);
    const regularPriceGroup = document.createElement("div");
    regularPriceGroup.className = "offer-regular-price-group";
    const regularPriceLabel = document.createElement("span");
    regularPriceLabel.className = "offer-price-label";
    regularPriceLabel.textContent = "Antes";
    const regularPrice = document.createElement("span");
    regularPrice.className = "offer-regular-price";
    regularPrice.textContent = formatMoney(product.unitPrice);
    regularPriceGroup.append(regularPriceLabel, regularPrice);
    prices.append(offerPriceGroup, regularPriceGroup);

    const deadline = document.createElement("p");
    deadline.className = promotion.type === "expiry"
      ? "offer-time-left offer-expiry-note"
      : "offer-time-left";
    const daysLeft = daysUntilExpiry(product);
    const expiryText = Number.isFinite(daysLeft)
      ? daysLeft === 0
        ? "Vence hoy"
        : daysLeft === 1
          ? "Falta 1 día para vencer"
          : `Faltan ${daysLeft} días para vencer`
      : "Sin fecha de vencimiento";
    deadline.textContent = promotion.type === "expiry"
      ? `${expiryText} · ${formatDate(product.expiryDate)}`
      : `${expiryText} · Oferta ${remainingOfferTime(product.offerEndsAt)}`;

    const actions = document.createElement("div");
    actions.className = "offer-card-actions";
    if (activeOffer(product)) {
      const editButton = document.createElement("button");
      editButton.className = "offer-edit-button";
      editButton.dataset.offerProductId = product.id;
      editButton.type = "button";
      editButton.textContent = "Editar oferta";
      actions.append(editButton);
    } else {
      const note = document.createElement("span");
      note.className = "offer-auto-note";
      note.textContent = "Descuento automático";
      actions.append(note);
    }

    card.append(top, prices, deadline, actions);
    elements.offersList.append(card);
  }
}

function renderAlertList(listElement, products, detailFor, emptyMessage) {
  listElement.replaceChildren();
  if (products.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "alert-empty";
    emptyItem.textContent = emptyMessage;
    listElement.append(emptyItem);
    return;
  }

  for (const product of products) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const detail = document.createElement("span");
    name.className = "alert-item-name";
    name.textContent = product.name;
    detail.className = "alert-item-detail";
    detail.textContent = detailFor(product);
    item.append(name, detail);
    listElement.append(item);
  }
}

function matchesFilter(product) {
  if (product.remainingQuantity <= 0) return false;
  const days = daysUntilExpiry(product);
  if (selectedFilter === "expiring") return days >= 0 && days <= alertDays;
  if (selectedFilter === "expired") return days < 0;
  if (selectedFilter === "low") return product.remainingQuantity <= LOW_STOCK_LIMIT;
  return true;
}

function renderInventory() {
  const query = elements.search.value.trim().toLocaleLowerCase("es");
  const products = inventory.products
    .filter(matchesFilter)
    .filter((product) => `${product.name} ${product.category} ${product.barcode ?? ""}`.toLocaleLowerCase("es").includes(query))
    .sort((first, second) => {
      if (!first.expiryDate) return second.expiryDate ? 1 : 0;
      if (!second.expiryDate) return -1;
      return first.expiryDate.localeCompare(second.expiryDate);
    });

  elements.inventoryBody.replaceChildren();
  elements.emptyState.hidden = inventory.products.length > 0;
  elements.noResults.hidden = inventory.products.length === 0 || products.length > 0;

  for (const product of products) {
    const status = expiryStatus(product);
    const promotion = currentPromotion(product);
    const row = document.createElement("tr");
    row.className = `inventory-row ${status.className}`;
    row.innerHTML = `
      <td data-label="Producto"><span class="product-name">${escapeHtml(product.name)}</span>${product.category ? `<span class="product-category">${escapeHtml(product.category)}</span>` : ""}</td>
      <td data-label="Ingreso">${formatDate(product.entryDate)}</td>
      <td data-label="Vencimiento">${product.expiryDate ? formatDate(product.expiryDate) : "No vence"}</td>
      <td data-label="Existencias"><span class="stock-number">${formatQuantity(product.remainingQuantity)}</span> / ${formatQuantity(product.quantity)}</td>
      <td data-label="Precio" class="price-cell">${promotion
        ? `<span class="offer-table-badge">${promotion.type === "expiry" ? `${promotion.percentage}% POR VENCER` : "OFERTA"}</span><span class="offer-price">${formatMoney(promotion.price)}</span><span class="offer-regular-price">${formatMoney(product.unitPrice)}</span>`
        : formatMoney(product.unitPrice)}</td>
      <td data-label="Código">${product.barcode ? escapeHtml(product.barcode) : "—"}</td>
      <td data-label="Estado"><span class="status ${status.className}">${status.label}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="small-button movement-button" data-product-id="${escapeHtml(product.id)}" type="button">Registrar salida</button>
        <button class="small-button offer-button" data-product-id="${escapeHtml(product.id)}" type="button">${activeOffer(product) ? "Editar oferta" : "Crear oferta"}</button>
      </div></td>
    `;
    elements.inventoryBody.append(row);
  }
}

function renderMovements() {
  const movements = [...inventory.movements]
    .sort((first, second) => second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt));
  elements.movementsBody.replaceChildren();
  elements.emptyMovements.hidden = movements.length > 0;

  for (const movement of movements) {
    const isSale = movement.type === "sale";
    const row = document.createElement("tr");
    row.className = isSale ? "movement-row movement-row-sale" : "movement-row movement-row-consumption";
    row.innerHTML = `
      <td data-label="Producto"><span class="product-name">${escapeHtml(movement.productName)}</span></td>
      <td data-label="Movimiento"><span class="movement-type ${isSale ? "movement-sale" : "movement-consumption"}">${isSale ? "Venta" : "Consumo / merma"}</span></td>
      <td data-label="Persona">${escapeHtml(movement.personName || "—")}</td>
      <td data-label="Cantidad">${formatQuantity(movement.quantity)}</td>
      <td data-label="Precio unitario">${formatMoney(movement.unitPrice)}</td>
      <td data-label="Total"><span class="movement-total">${formatMoney(movement.total)}</span></td>
      <td data-label="Fecha">${formatDate(movement.date)}</td>
    `;
    elements.movementsBody.append(row);
  }
}

function render() {
  renderSummary();
  renderAlerts();
  renderOffers();
  renderInventory();
  renderMovements();
}

function openProductDialog({ barcode = "", templateProduct = null } = {}) {
  elements.productForm.reset();
  setError(elements.productError);
  const today = localDateString();
  elements.productForm.elements.entryDate.value = today;
  elements.productForm.elements.expiryDate.min = today;
  elements.noExpiry.checked = false;
  elements.expiryDate.disabled = false;
  elements.productForm.elements.barcode.value = barcode;
  if (templateProduct) {
    elements.productForm.elements.name.value = templateProduct.name;
    elements.productForm.elements.category.value = templateProduct.category;
    if (Number.isFinite(templateProduct.unitCost)) {
      elements.productForm.elements.unitCost.value = templateProduct.unitCost;
    }
    if (Number.isFinite(templateProduct.unitPrice)) {
      elements.productForm.elements.unitPrice.value = templateProduct.unitPrice;
    }
  }
  elements.productDialog.showModal();
}

function renderCatalog() {
  const query = elements.catalogSearch.value.trim().toLocaleLowerCase("es");
  const category = elements.catalogCategory.value;
  const matches = window.PULPERIA_CATALOG.filter((product) =>
    (!category || product.category === category) &&
    `${product.name} ${product.category}`.toLocaleLowerCase("es").includes(query),
  );

  elements.catalogCount.textContent =
    `${matches.length} ${matches.length === 1 ? "producto" : "productos"}`;
  elements.catalogEmpty.hidden = matches.length > 0;
  elements.catalogList.replaceChildren();

  for (const product of matches) {
    const button = document.createElement("button");
    button.className = "catalog-item";
    button.type = "button";
    button.dataset.catalogName = product.name;
    button.innerHTML =
      `<span class="catalog-item-name">${escapeHtml(product.name)}</span><span class="catalog-item-category">${escapeHtml(product.category)}</span><span class="catalog-item-add" aria-hidden="true">＋</span>`;
    elements.catalogList.append(button);
  }
}

function openCatalog() {
  productDraft = Object.fromEntries(new FormData(elements.productForm));
  elements.productDialog.close();
  elements.catalogSearch.value = "";
  elements.catalogCategory.value = "";
  renderCatalog();
  elements.catalogDialog.showModal();
}

function chooseCatalogProduct(productName) {
  const product = window.PULPERIA_CATALOG.find((item) => item.name === productName);
  if (!product) return;

  elements.catalogDialog.close();
  openProductDialog({ templateProduct: product });
  if (productDraft) {
    for (const field of ["barcode", "quantity", "entryDate", "expiryDate", "unitCost", "unitPrice"]) {
      elements.productForm.elements[field].value = productDraft[field] ?? "";
    }
    elements.noExpiry.checked = productDraft.noExpiry === "on";
    elements.expiryDate.disabled = elements.noExpiry.checked;
    elements.expiryDate.value = elements.noExpiry.checked ? "" : elements.expiryDate.value;
  }
  productDraft = null;
}

function openMovementDialog(product) {
  elements.movementForm.reset();
  setError(elements.movementError);
  elements.movementForm.elements.productId.value = product.id;
  elements.movementPersonField.hidden = elements.movementForm.elements.type.value !== "sale";
  elements.movementForm.elements.date.value = localDateString();
  elements.movementForm.elements.quantity.max = product.remainingQuantity;
  elements.movementProductLabel.textContent =
    `${product.name} · ${product.remainingQuantity} unidades disponibles`;
  updateMovementPrice(product, elements.movementForm.elements.type.value);
  elements.movementDialog.showModal();
}

function previousPersonPrice(product, personName) {
  const normalizedName = personName.trim().toLocaleLowerCase();
  if (!normalizedName) return null;
  const previousSale = inventory.movements
    .filter((movement) => movement.type === "sale" &&
      movement.productId === product.id &&
      movement.personName?.trim().toLocaleLowerCase() === normalizedName)
    .sort((first, second) =>
      second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt))[0];
  return previousSale?.unitPrice ?? null;
}

function availableForCart(product) {
  return product.remainingQuantity > 0 && daysUntilExpiry(product) >= 0;
}

function suggestedSalePrice(product, personName) {
  const promotion = currentPromotion(product);
  const personPrice = previousPersonPrice(product, personName);
  return personPrice === null
    ? promotion?.price ?? product.unitPrice
    : promotion ? Math.min(personPrice, promotion.price) : personPrice;
}

function openCartDialog() {
  elements.cartForm.reset();
  setError(elements.cartError);
  cartItems = [];
  renderCart();
  renderCartMenu();
  elements.cartDialog.showModal();
}

function renderCartMenu() {
  const query = elements.cartSearch.value.trim().toLocaleLowerCase();
  const personName = elements.cartForm.elements.personName.value;
  const availableProducts = inventory.products.filter((product) =>
    availableForCart(product) &&
    `${product.name} ${product.category}`.toLocaleLowerCase().includes(query));
  elements.cartMenu.replaceChildren();
  elements.cartMenuEmpty.hidden = availableProducts.length > 0;
  for (const product of availableProducts) {
    const cartItem = cartItems.find((item) => item.productId === product.id);
    const remaining = product.remainingQuantity - (cartItem?.quantity ?? 0);
    const promotion = currentPromotion(product);
    const card = document.createElement("article");
    card.className = "cart-menu-item";
    card.innerHTML = `
      <div class="cart-menu-details">
        <strong>${escapeHtml(product.name)}</strong>
        <span>${escapeHtml(product.category || "Producto")} · ${formatQuantity(Math.max(remaining, 0))} disponibles</span>
      </div>
      <div class="cart-menu-price">
        <strong>${formatMoney(suggestedSalePrice(product, personName))}</strong>
        ${promotion ? `<span>${promotion.type === "expiry" ? `${promotion.percentage}% por vencer` : "Oferta"}</span>` : ""}
      </div>
      <button class="small-button cart-add-button" data-cart-add="${escapeHtml(product.id)}" type="button"
        ${remaining <= 0 ? "disabled" : ""}>${cartItem ? "Agregar otro" : "Agregar"}</button>
    `;
    elements.cartMenu.append(card);
  }
}

function renderCart() {
  elements.cartItems.replaceChildren();
  elements.cartEmpty.hidden = cartItems.length > 0;
  let total = 0;
  for (const item of cartItems) {
    const product = inventory.products.find((candidate) => candidate.id === item.productId);
    if (!product) continue;
    const lineTotal = item.quantity * item.unitPrice;
    total += lineTotal;
    const row = document.createElement("div");
    row.className = "cart-order-item";
    row.innerHTML = `
      <div class="cart-order-product">
        <strong>${escapeHtml(product.name)}</strong>
        <span>${formatMoney(lineTotal)}</span>
      </div>
      <label>Cant.
        <input data-cart-quantity="${escapeHtml(product.id)}" type="number" min="0.01"
          max="${product.remainingQuantity}" step="any" value="${item.quantity}" aria-label="Cantidad de ${escapeHtml(product.name)}" />
      </label>
      <label>Precio c/u
        <input data-cart-price="${escapeHtml(product.id)}" type="number" min="0"
          step="any" value="${item.unitPrice}" aria-label="Precio unitario de ${escapeHtml(product.name)}" />
      </label>
      <button class="small-button cart-remove-button" data-cart-remove="${escapeHtml(product.id)}"
        type="button" aria-label="Quitar ${escapeHtml(product.name)}">Quitar</button>
    `;
    elements.cartItems.append(row);
  }
  elements.cartTotal.textContent = Number.isFinite(total) ? formatMoney(total) : "—";
  elements.checkoutButton.disabled = cartItems.length === 0;
}

function refreshCartSuggestions() {
  const personName = elements.cartForm.elements.personName.value;
  for (const item of cartItems) {
    if (item.priceEdited) continue;
    const product = inventory.products.find((candidate) => candidate.id === item.productId);
    if (product) item.unitPrice = suggestedSalePrice(product, personName);
  }
  renderCart();
  renderCartMenu();
}

function updateMovementPrice(product, type) {
  const isSale = type === "sale";
  const promotion = isSale ? currentPromotion(product) : null;
  elements.movementPriceLabel.firstChild.textContent = promotion?.type === "expiry"
    ? `Precio con descuento por vencimiento (${promotion.percentage}%) por unidad para esta persona`
    : promotion
      ? "Precio de oferta por unidad para esta persona"
      : isSale ? "Precio de venta por unidad para esta persona" : "Precio de costo por unidad";
  elements.movementPersonField.hidden = !isSale;
  elements.movementPriceHint.textContent = isSale
    ? "Puede ajustar el precio para esta persona. Al volver a escribir su nombre, se sugerirá el último precio que pagó por este producto."
    : "El precio de costo por unidad se registra como referencia para este consumo o merma.";
  const personPrice = isSale
    ? previousPersonPrice(product, elements.movementForm.elements.personName.value)
    : null;
  elements.movementForm.elements.unitPrice.value =
    isSale
      ? personPrice === null ? promotion?.price ?? product.unitPrice
        : promotion ? Math.min(personPrice, promotion.price) : personPrice
      : product.unitCost;
}

function openOfferDialog(product) {
  elements.offerForm.reset();
  setError(elements.offerError);
  const hasActiveOffer = activeOffer(product);
  const now = new Date();
  elements.offerForm.elements.productId.value = product.id;
  elements.offerForm.elements.offerPrice.value = hasActiveOffer ? product.offerPrice : "";
  elements.offerForm.elements.offerEndsAt.min = localDateTimeValue(
    new Date(now.getTime() + 60_000),
  );
  elements.offerForm.elements.offerEndsAt.value = hasActiveOffer
    ? product.offerEndsAt
    : localDateTimeValue(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  elements.offerProductLabel.textContent =
    `${product.name} · precio normal ${formatMoney(product.unitPrice)}`;
  elements.offerDialogTitle.textContent = hasActiveOffer ? "Editar oferta" : "Crear oferta";
  elements.removeOfferButton.hidden = !hasActiveOffer;
  elements.offerDialog.showModal();
}

function openScanner(mode = "lookup", target = null) {
  scannerMode = mode;
  scannerTarget = target;
  scannerReturnDialog = mode === "fill" && elements.productDialog.open
    ? elements.productDialog
    : null;
  elements.scannerManualInput.value = "";
  elements.scannerPlaceholder.hidden = false;
  elements.scannerStatus.textContent =
    "También puede escribir el código manualmente.";
  if (window.BarcodeDetector && navigator.mediaDevices?.getUserMedia &&
      !window.isSecureContext) {
    elements.scannerStatus.textContent =
      "Para usar la cámara, abra la app con HTTPS. Mientras tanto, escriba el código manualmente.";
  } else if (!window.BarcodeDetector) {
    elements.scannerStatus.textContent =
      "Este navegador no admite lectura de códigos por cámara. Puede escribir el código manualmente.";
  }
  elements.scannerDialog.showModal();
}

function stopScannerCamera() {
  scannerRequestId += 1;
  if (scannerAnimationFrame !== null) {
    window.cancelAnimationFrame(scannerAnimationFrame);
    scannerAnimationFrame = null;
  }
  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }
  elements.scannerVideo.pause();
  elements.scannerVideo.srcObject = null;
  elements.scannerPlaceholder.hidden = false;
  elements.scannerStartButton.textContent = "Iniciar cámara";
}

async function startScannerCamera() {
  stopScannerCamera();
  const requestId = scannerRequestId;
  if (!window.isSecureContext) {
    elements.scannerStatus.textContent =
      "La cámara necesita HTTPS (o localhost). Use el campo manual o abra la app mediante una dirección HTTPS.";
    return;
  }
  if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
    elements.scannerStatus.textContent =
      "No está disponible la lectura por cámara en este navegador. Escriba el código manualmente.";
    return;
  }

  elements.scannerStartButton.disabled = true;
  elements.scannerStatus.textContent = "Solicitando permiso para usar la cámara…";
  try {
    const supportedFormats = await window.BarcodeDetector.getSupportedFormats();
    if (requestId !== scannerRequestId || !elements.scannerDialog.open) return;
    const formats = [
      "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf",
    ].filter((format) => supportedFormats.includes(format));
    if (formats.length === 0) {
      elements.scannerStatus.textContent =
        "Este navegador no reconoce formatos de código de barras comunes. Escriba el código manualmente.";
      return;
    }
    const detector = new window.BarcodeDetector({ formats });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    if (requestId !== scannerRequestId || !elements.scannerDialog.open) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    scannerStream = stream;
    elements.scannerVideo.srcObject = scannerStream;
    await elements.scannerVideo.play();
    if (requestId !== scannerRequestId || !elements.scannerDialog.open) {
      stopScannerCamera();
      return;
    }
    elements.scannerPlaceholder.hidden = true;
    elements.scannerStartButton.textContent = "Reiniciar cámara";
    elements.scannerStatus.textContent = "Apunte la cámara al código de barras.";

    const scanFrame = async () => {
      if (!scannerStream || !elements.scannerDialog.open) return;
      if (elements.scannerVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const [result] = await detector.detect(elements.scannerVideo);
          if (requestId !== scannerRequestId || !elements.scannerDialog.open) return;
          if (result?.rawValue) {
            await useScannedBarcode(result.rawValue);
            return;
          }
        } catch (error) {
          console.error("No se pudo leer el código de barras.", error);
          elements.scannerStatus.textContent =
            "No se pudo leer el código. Ajuste la cámara o escriba el código manualmente.";
          stopScannerCamera();
          return;
        }
      }
      scannerAnimationFrame = window.requestAnimationFrame(scanFrame);
    };
    scannerAnimationFrame = window.requestAnimationFrame(scanFrame);
  } catch (error) {
    console.error("No se pudo iniciar el lector de códigos.", error);
    const message = error.name === "NotAllowedError"
      ? "No se concedió permiso para usar la cámara. Puede escribir el código manualmente."
      : "No se pudo iniciar la cámara. Revise el permiso del navegador o escriba el código manualmente.";
    elements.scannerStatus.textContent = message;
    stopScannerCamera();
  } finally {
    elements.scannerStartButton.disabled = false;
  }
}

async function useScannedBarcode(rawValue) {
  const barcode = String(rawValue).trim();
  if (!barcode) return;
  stopScannerCamera();
  if (scannerMode === "fill") {
    elements.productForm.elements[scannerTarget].value = barcode;
    elements.scannerDialog.close();
    if (scannerReturnDialog && !scannerReturnDialog.open) {
      scannerReturnDialog.showModal();
    }
    return;
  }

  const matchingProducts = inventory.products.filter((product) => product.barcode === barcode);
  const sellableProduct = matchingProducts
    .filter((product) => product.remainingQuantity > 0 && daysUntilExpiry(product) >= 0)
    .sort((first, second) => {
      if (!first.expiryDate) return second.expiryDate ? 1 : 0;
      if (!second.expiryDate) return -1;
      return first.expiryDate.localeCompare(second.expiryDate);
    })[0];
  elements.scannerDialog.close();

  if (sellableProduct) {
    openMovementDialog(sellableProduct);
    return;
  }

  const expiredStock = matchingProducts.find(
    (product) => product.remainingQuantity > 0 && daysUntilExpiry(product) < 0,
  );
  if (expiredStock) {
    window.alert(`${expiredStock.name} tiene existencias vencidas. No se puede registrar la venta de ese lote.`);
    return;
  }

  openProductDialog({
    barcode,
    templateProduct: matchingProducts.at(-1) ?? null,
  });
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateTodayHeader() {
  const now = new Date();
  document.querySelector("#today-label").textContent =
    new Intl.DateTimeFormat("es-CR", { dateStyle: "full" }).format(now);
  const greeting = now.getHours() < 12
    ? "Buenos días"
    : now.getHours() < 18 ? "Buenas tardes" : "Buenas noches";
  document.querySelector("h1").textContent = `${greeting}, pulpero.`;
}

updateTodayHeader();

document.querySelector("#open-cart-button").addEventListener("click", openCartDialog);
document.querySelector("#add-product-button").addEventListener("click", openProductDialog);
document.querySelector("#empty-add-button").addEventListener("click", openProductDialog);
document.querySelector("#scan-button").addEventListener("click", () => openScanner());
document.querySelector("#inventory-scan-button").addEventListener("click", () => openScanner());
document.querySelector("#open-catalog-button").addEventListener("click", openCatalog);
elements.search.addEventListener("input", renderInventory);
elements.catalogSearch.addEventListener("input", renderCatalog);
elements.catalogCategory.addEventListener("change", renderCatalog);

const catalogCategories = [...new Set(window.PULPERIA_CATALOG.map((product) => product.category))];
for (const category of catalogCategories) {
  const option = document.createElement("option");
  option.value = category;
  option.textContent = category;
  elements.catalogCategory.append(option);
}
renderCatalog();

elements.catalogList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-catalog-name]");
  if (button) chooseCatalogProduct(button.dataset.catalogName);
});

elements.cartSearch.addEventListener("input", renderCartMenu);
elements.cartForm.elements.personName.addEventListener("input", refreshCartSuggestions);
elements.cartMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cart-add]");
  if (!button) return;
  const product = inventory.products.find((item) => item.id === button.dataset.cartAdd);
  if (!product || !availableForCart(product)) return;
  const cartItem = cartItems.find((item) => item.productId === product.id);
  if (cartItem) {
    if (cartItem.quantity >= product.remainingQuantity) return;
    cartItem.quantity = Math.min(cartItem.quantity + 1, product.remainingQuantity);
  } else {
    cartItems.push({
      productId: product.id,
      quantity: 1,
      unitPrice: suggestedSalePrice(product, elements.cartForm.elements.personName.value),
      priceEdited: false,
    });
  }
  setError(elements.cartError);
  renderCart();
  renderCartMenu();
});

elements.cartItems.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cart-remove]");
  if (!button) return;
  cartItems = cartItems.filter((item) => item.productId !== button.dataset.cartRemove);
  renderCart();
  renderCartMenu();
});

elements.cartItems.addEventListener("change", (event) => {
  const input = event.target;
  const item = cartItems.find((candidate) =>
    candidate.productId === (input.dataset.cartQuantity ?? input.dataset.cartPrice));
  if (!item) return;
  if (input.matches("[data-cart-quantity]")) {
    item.quantity = parseNumericInput(input.value);
  } else {
    item.unitPrice = parseNumericInput(input.value);
    item.priceEdited = true;
  }
  renderCart();
  renderCartMenu();
});

elements.cartForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(elements.cartError);
  const personName = elements.cartForm.elements.personName.value.trim();
  if (!personName || personName.length > 80) {
    setError(elements.cartError, "Escriba el nombre de la persona que realiza la compra.");
    elements.cartForm.elements.personName.focus();
    return;
  }
  if (cartItems.length === 0) {
    setError(elements.cartError, "Agregue al menos un producto a la compra.");
    return;
  }

  const date = localDateString();
  const checkedItems = [];
  for (const item of cartItems) {
    const product = inventory.products.find((candidate) => candidate.id === item.productId);
    if (!product || !availableForCart(product)) {
      setError(elements.cartError, "Uno de los productos ya no está disponible. Revise el menú.");
      renderCartMenu();
      return;
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 ||
        item.quantity > product.remainingQuantity ||
        !Number.isFinite(item.unitPrice) || item.unitPrice < 0 ||
        date < product.entryDate) {
      setError(elements.cartError, `Revise la cantidad y el precio de ${product.name}; la cantidad no puede superar las existencias disponibles.`);
      return;
    }
    checkedItems.push({ item, product });
  }

  const previousQuantities = checkedItems.map(({ product }) => product.remainingQuantity);
  const previousMovementCount = inventory.movements.length;
  const orderId = createId();
  for (const { item, product } of checkedItems) {
    product.remainingQuantity -= item.quantity;
    inventory.movements.push({
      id: createId(),
      productId: product.id,
      productName: product.name,
      orderId,
      type: "sale",
      personName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      unitCost: product.unitCost,
      total: item.quantity * item.unitPrice,
      date,
      createdAt: new Date().toISOString(),
    });
  }

  elements.checkoutButton.disabled = true;
  try {
    await saveInventory();
  } catch (error) {
    checkedItems.forEach(({ product }, index) => {
      product.remainingQuantity = previousQuantities[index];
    });
    inventory.movements.length = previousMovementCount;
    setError(elements.cartError, `No se pudo guardar la compra: ${error.message}`);
    elements.checkoutButton.disabled = false;
    return;
  }

  elements.cartDialog.close();
  cartItems = [];
  render();
});

elements.noExpiry.addEventListener("change", () => {
  elements.expiryDate.disabled = elements.noExpiry.checked;
  if (elements.noExpiry.checked) {
    elements.expiryDate.value = "";
  } else {
    elements.expiryDate.focus();
  }
});
elements.alertDays.value = String(alertDays);
elements.alertDays.addEventListener("change", (event) => {
  const selectedDays = Number(event.target.value);
  if (!ALLOWED_ALERT_DAYS.includes(selectedDays)) {
    event.target.value = String(alertDays);
    return;
  }
  if (saveAlertDays(selectedDays)) {
    render();
  } else {
    event.target.value = String(alertDays);
  }
});

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((filter) => {
      filter.classList.toggle("is-active", filter === button);
    });
    renderInventory();
  });
});

document.querySelectorAll("[data-alert-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.alertFilter;
    const filterButton = document.querySelector(`.filter-button[data-filter="${filter}"]`);
    filterButton.click();
    document.querySelector("#inventory-body").closest(".content-card").scrollIntoView({ behavior: "smooth" });
  });
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.close}`).close());
});

document.querySelectorAll("[data-scan-target]").forEach((button) => {
  button.addEventListener("click", () => openScanner("fill", button.dataset.scanTarget));
});

elements.scannerStartButton.addEventListener("click", startScannerCamera);
elements.scannerDialog.addEventListener("close", stopScannerCamera);
elements.scannerManualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const barcode = elements.scannerManualInput.value.trim();
  if (!barcode) {
    elements.scannerStatus.textContent = "Escriba un código de barras para continuar.";
    elements.scannerManualInput.focus();
    return;
  }
  await useScannedBarcode(barcode);
});

elements.inventoryBody.addEventListener("click", (event) => {
  const button = event.target.closest(".offer-button");
  if (!button) return;
  const product = inventory.products.find((item) => item.id === button.dataset.productId);
  if (product) openOfferDialog(product);
});

elements.productForm.elements.entryDate.addEventListener("change", (event) => {
  elements.productForm.elements.expiryDate.min = event.target.value;
});

elements.productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(elements.productError);
  const form = new FormData(elements.productForm);
  const product = {
    id: createId(),
    name: String(form.get("name")).trim(),
    category: String(form.get("category")).trim(),
    barcode: String(form.get("barcode")).trim(),
    entryDate: String(form.get("entryDate")),
    expiryDate: form.has("noExpiry") ? "" : String(form.get("expiryDate") ?? ""),
    quantity: parseNumericInput(form.get("quantity")),
    remainingQuantity: parseNumericInput(form.get("quantity")),
    unitCost: parseNumericInput(form.get("unitCost")),
    unitPrice: parseNumericInput(form.get("unitPrice")),
    offerPrice: null,
    offerEndsAt: null,
    createdAt: new Date().toISOString(),
  };

  if (!product.name || !product.entryDate ||
      !Number.isFinite(product.quantity) || product.quantity <= 0 ||
      !Number.isFinite(product.unitCost) || product.unitCost < 0 ||
      !Number.isFinite(product.unitPrice) || product.unitPrice < 0) {
    setError(elements.productError, "Revise los campos: la cantidad debe ser mayor que cero y los precios no pueden ser negativos.");
    return;
  }
  if (!product.expiryDate && !form.has("noExpiry")) {
    setError(elements.productError, "Indique la fecha de vencimiento o marque «Este producto no tiene fecha de vencimiento».");
    return;
  }
  if (product.expiryDate && !isValidDate(product.expiryDate)) {
    setError(elements.productError, "La fecha de vencimiento no es válida.");
    return;
  }
  if (product.expiryDate && product.expiryDate < product.entryDate) {
    setError(elements.productError, "La fecha de vencimiento debe ser igual o posterior a la fecha de ingreso.");
    return;
  }
  if (product.entryDate > localDateString()) {
    setError(elements.productError, "La fecha de ingreso no puede ser futura.");
    return;
  }

  inventory.products.push(product);
  try {
    await saveInventory();
  } catch (error) {
    inventory.products.pop();
    setError(elements.productError, `No se pudo guardar el producto: ${error.message}`);
    return;
  }
  elements.productDialog.close();
  render();
});

elements.inventoryBody.addEventListener("click", (event) => {
  const button = event.target.closest(".movement-button");
  if (!button) return;
  const product = inventory.products.find((item) => item.id === button.dataset.productId);
  if (product) openMovementDialog(product);
});

elements.movementForm.elements.type.addEventListener("change", (event) => {
  const product = inventory.products.find((item) => item.id === elements.movementForm.elements.productId.value);
  if (product) {
    if (event.target.value !== "sale") elements.movementForm.elements.personName.value = "";
    updateMovementPrice(product, event.target.value);
  }
});

elements.movementForm.elements.personName.addEventListener("input", () => {
  const product = inventory.products.find((item) => item.id === elements.movementForm.elements.productId.value);
  if (product && elements.movementForm.elements.type.value === "sale") {
    updateMovementPrice(product, "sale");
  }
});

elements.offerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(elements.offerError);
  const form = new FormData(elements.offerForm);
  const product = inventory.products.find((item) => item.id === form.get("productId"));
  const offerPrice = parseNumericInput(form.get("offerPrice"));
  const offerEndsAt = String(form.get("offerEndsAt"));

  if (!product || product.remainingQuantity <= 0 ||
      daysUntilExpiry(product) < 0 ||
      !Number.isFinite(offerPrice) || offerPrice < 0 ||
      offerPrice >= product.unitPrice || !isValidDateTime(offerEndsAt)) {
    setError(elements.offerError, "No se puede ofrecer un lote vencido o agotado. El precio debe ser menor que el normal y la fecha límite debe ser válida.");
    return;
  }
  if (new Date(offerEndsAt).getTime() <= Date.now()) {
    setError(elements.offerError, "La oferta debe terminar en una fecha y hora futuras.");
    return;
  }

  const previousOffer = { offerPrice: product.offerPrice, offerEndsAt: product.offerEndsAt };
  product.offerPrice = offerPrice;
  product.offerEndsAt = offerEndsAt;
  try {
    await saveInventory();
  } catch (error) {
    product.offerPrice = previousOffer.offerPrice;
    product.offerEndsAt = previousOffer.offerEndsAt;
    setError(elements.offerError, `No se pudo guardar la oferta: ${error.message}`);
    return;
  }
  elements.offerDialog.close();
  render();
});

elements.removeOfferButton.addEventListener("click", async () => {
  const product = inventory.products.find((item) => item.id === elements.offerForm.elements.productId.value);
  if (!product) return;
  const previousOffer = { offerPrice: product.offerPrice, offerEndsAt: product.offerEndsAt };
  product.offerPrice = null;
  product.offerEndsAt = null;
  try {
    await saveInventory();
  } catch (error) {
    product.offerPrice = previousOffer.offerPrice;
    product.offerEndsAt = previousOffer.offerEndsAt;
    setError(elements.offerError, `No se pudo quitar la oferta: ${error.message}`);
    return;
  }
  elements.offerDialog.close();
  render();
});

elements.offersList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-offer-product-id]");
  if (!button) return;
  const product = inventory.products.find((item) => item.id === button.dataset.offerProductId);
  if (product) openOfferDialog(product);
});

elements.movementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(elements.movementError);
  const form = new FormData(elements.movementForm);
  const product = inventory.products.find((item) => item.id === form.get("productId"));
  const quantity = parseNumericInput(form.get("quantity"));
  const unitPrice = parseNumericInput(form.get("unitPrice"));
  const date = String(form.get("date"));
  const personName = String(form.get("personName") || "").trim();

  if (!product || !Number.isFinite(quantity) || quantity <= 0 ||
      !Number.isFinite(unitPrice) || unitPrice < 0 || !date || personName.length > 80) {
    setError(elements.movementError, "Revise la cantidad, el precio y la fecha del movimiento.");
    return;
  }
  if (date > localDateString()) {
    setError(elements.movementError, "La fecha del movimiento no puede ser futura.");
    return;
  }
  if (date < product.entryDate) {
    setError(elements.movementError, "La fecha del movimiento no puede ser anterior al ingreso del producto.");
    return;
  }
  if (form.get("type") === "sale" && daysUntilExpiry(product) < 0) {
    setError(elements.movementError, "No se puede vender un lote vencido. Registre la salida como consumo o merma.");
    return;
  }
  if (quantity > product.remainingQuantity) {
    setError(elements.movementError, `Solo hay ${product.remainingQuantity} unidades disponibles.`);
    return;
  }

  const movement = {
    id: createId(),
    productId: product.id,
    productName: product.name,
    type: String(form.get("type")),
    quantity,
    unitPrice,
    unitCost: product.unitCost,
    total: quantity * unitPrice,
    date,
    createdAt: new Date().toISOString(),
  };
  if (movement.type === "sale" && personName) movement.personName = personName;
  product.remainingQuantity -= quantity;
  inventory.movements.push(movement);
  try {
    await saveInventory();
  } catch (error) {
    product.remainingQuantity += quantity;
    inventory.movements.pop();
    setError(elements.movementError, `No se pudo guardar el movimiento: ${error.message}`);
    return;
  }
  elements.movementDialog.close();
  render();
});

document.querySelector("#backup-button").addEventListener("click", () => {
  const backup = {
    format: "mi-pulperia-inventario",
    version: 1,
    exportedAt: new Date().toISOString(),
    ...inventory,
  };
  downloadFile(`respaldo-pulperia-${localDateString()}.json`, JSON.stringify(backup, null, 2), "application/json");
});

document.querySelector("#restore-button").addEventListener("click", () => {
  elements.importInput.click();
});

elements.importInput.addEventListener("change", async () => {
  const [file] = elements.importInput.files;
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== "mi-pulperia-inventario" || backup.version !== 1 ||
        !isValidInventory(backup)) {
      throw new Error("El archivo no es un respaldo válido de Mi Pulpería.");
    }
    if (!window.confirm("Importar este respaldo reemplazará los datos actuales. ¿Desea continuar?")) return;
    const previousInventory = inventory;
    inventory = { products: backup.products, movements: backup.movements };
    try {
      await saveInventory();
    } catch (error) {
      inventory = previousInventory;
      throw error;
    }
    render();
    window.alert("Respaldo importado correctamente.");
  } catch (error) {
    console.error("No se pudo importar el respaldo.", error);
    window.alert(`No se pudo importar el respaldo: ${error.message}`);
  } finally {
    elements.importInput.value = "";
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await apiRequest("logout", { method: "POST" });
    window.location.replace("/login");
  } catch (error) {
    window.alert(`No se pudo cerrar la sesión: ${error.message}`);
  }
});

async function initializeApp() {
  try {
    const session = await apiRequest("session");
    if (!session.authenticated) {
      window.location.replace("/login");
      return;
    }
    await loadInventory();
    render();
    document.body.classList.remove("app-loading");
    window.setInterval(() => {
      updateTodayHeader();
      renderSummary();
      renderAlerts();
      renderOffers();
      renderInventory();
    }, 15_000);
  } catch (error) {
    console.error("No se pudo iniciar la aplicación.", error);
    document.querySelector("#app-status").textContent =
      `No se pudo cargar el inventario. ${error.message} Compruebe la conexión y vuelva a cargar la página.`;
  }
}

initializeApp();
