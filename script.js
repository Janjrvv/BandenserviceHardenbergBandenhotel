"use strict";

const REGISTRATIONS_KEY = "bandenhotel_registraties";
const CUSTOMERS_KEY = "bandenhotel_klanten";
const TRASH_KEY = "bandenhotel_prullenbak";
const SECURE_DATA_KEY = "bandenhotel_beveiligde_data";
const SECURE_SALT_KEY = "bandenhotel_beveiligde_salt";
const SECURITY_SCOPE = "Bandenservice Hardenberg";
const ACCESS_PASSWORD_HASH = "046cf13e812417320bbc228a6d29ba41b95c07116bcd87a932627ac71c1be0c6";
const TRASH_PASSWORD_HASH = "8b7f05b62b121eb7848511201a774e0f21dd2e81a93da6bfebaf6df453d62066";
const TOTAL_LETTERS = 26;
const SPOTS_PER_LETTER = 3;
const SETS_PER_LOCATION = 6;
const TIRE_SEASONS = ["Zomerbanden", "Winterbanden"];
const BACKUP_VERSION = 3;

const locations = createLocations();
const TOTAL_SET_SLOTS = locations.length * SETS_PER_LOCATION;

let registrations = [];
let customers = [];
let trashRegistrations = [];
let formDraft = {};
let jsonSnapshots = [];
let selectedLocation = "";
let activeLocation = "";
let lastNoResultsQuery = "";
let lastAutoFilledCustomer = "";
let latestBackupUrl = "";
let latestBackupFileName = "";
let securityKey = null;
let appEventsBound = false;
let trashUnlocked = false;
let jsonUnlocked = false;
let draftSaveTimer = null;

const elements = {
  authForm: document.getElementById("authForm"),
  accessPassword: document.getElementById("accessPassword"),
  accessPasswordError: document.getElementById("accessPasswordError"),
  form: document.getElementById("checkinForm"),
  totalSlots: document.getElementById("totalSlots"),
  totalSetSlots: document.getElementById("totalSetSlots"),
  occupiedSlots: document.getElementById("occupiedSlots"),
  freeSlots: document.getElementById("freeSlots"),
  occupancyRate: document.getElementById("occupancyRate"),
  customerName: document.getElementById("customerName"),
  customerEmail: document.getElementById("customerEmail"),
  customerPhone: document.getElementById("customerPhone"),
  licensePlate: document.getElementById("licensePlate"),
  carType: document.getElementById("carType"),
  tireProfile: document.getElementById("tireProfile"),
  tireBrand: document.getElementById("tireBrand"),
  tireName: document.getElementById("tireName"),
  tireSeason: document.getElementById("tireSeason"),
  storageLocation: document.getElementById("storageLocation"),
  customerSuggestions: document.getElementById("customerSuggestions"),
  locationGrid: document.getElementById("locationGrid"),
  locationSetDetails: document.getElementById("locationSetDetails"),
  registrationsBody: document.getElementById("registrationsBody"),
  emptyState: document.getElementById("emptyState"),
  searchInput: document.getElementById("searchInput"),
  ageFilter: document.getElementById("ageFilter"),
  backupDownload: document.getElementById("backupDownload"),
  backupImport: document.getElementById("backupImport"),
  backupImportInput: document.getElementById("backupImportInput"),
  jsonOpen: document.getElementById("jsonOpen"),
  jsonModal: document.getElementById("jsonModal"),
  closeJsonModal: document.getElementById("closeJsonModal"),
  jsonAuthForm: document.getElementById("jsonAuthForm"),
  jsonPassword: document.getElementById("jsonPassword"),
  jsonPasswordError: document.getElementById("jsonPasswordError"),
  jsonContent: document.getElementById("jsonContent"),
  jsonSnapshotBody: document.getElementById("jsonSnapshotBody"),
  jsonEmptyState: document.getElementById("jsonEmptyState"),
  jsonPreview: document.getElementById("jsonPreview"),
  trashOpen: document.getElementById("trashOpen"),
  trashModal: document.getElementById("trashModal"),
  closeTrashModal: document.getElementById("closeTrashModal"),
  trashAuthForm: document.getElementById("trashAuthForm"),
  trashPassword: document.getElementById("trashPassword"),
  trashPasswordError: document.getElementById("trashPasswordError"),
  trashContent: document.getElementById("trashContent"),
  trashSearchInput: document.getElementById("trashSearchInput"),
  trashAgeFilter: document.getElementById("trashAgeFilter"),
  trashBody: document.getElementById("trashBody"),
  trashEmptyState: document.getElementById("trashEmptyState"),
  detailModal: document.getElementById("detailModal"),
  modalDetails: document.getElementById("modalDetails"),
  modalTitle: document.getElementById("modalTitle"),
  closeModal: document.getElementById("closeModal"),
  toastContainer: document.getElementById("toastContainer")
};

const fields = [
  "customerName",
  "customerEmail",
  "customerPhone",
  "licensePlate",
  "carType",
  "tireProfile",
  "tireBrand",
  "tireName",
  "tireSeason",
  "storageLocation"
];

bindAuthEvents();

function bindAuthEvents() {
  elements.authForm.addEventListener("submit", handleAccessLogin);
}

async function handleAccessLogin(event) {
  event.preventDefault();
  elements.accessPasswordError.textContent = "";

  if (!window.crypto?.subtle) {
    elements.accessPasswordError.textContent = "Deze browser ondersteunt geen beveiligde opslag.";
    return;
  }

  const password = elements.accessPassword.value;
  const isValid = await verifyPassword(password, "site", ACCESS_PASSWORD_HASH);

  if (!isValid) {
    elements.accessPasswordError.textContent = "Wachtwoord is onjuist.";
    elements.accessPassword.setAttribute("aria-invalid", "true");
    return;
  }

  try {
    securityKey = await deriveStorageKey(password);
    const secureState = await loadSecureState();
    registrations = cleanRegistrations(secureState.registrations);
    trashRegistrations = cleanTrashRegistrations(secureState.trash);
    formDraft = cleanFormDraft(secureState.formDraft);
    jsonSnapshots = cleanJsonSnapshots(secureState.jsonSnapshots);
    customers = cleanCustomers([
      ...secureState.customers,
      ...deriveCustomersFromRegistrations(registrations)
    ]);
    if (!jsonSnapshots.length && (registrations.length || trashRegistrations.length || hasDraftContent(formDraft))) {
      createJsonSnapshot("Eerste automatische opslag");
    }

    await persistAll();
    bindAppEvents();
    document.body.classList.remove("auth-locked");
    elements.accessPassword.value = "";
    elements.accessPassword.removeAttribute("aria-invalid");
    renderAll();
    restoreFormDraft();
    prepareBackupDownload();
    showToast("Toegang verleend", "Klantgegevens zijn beveiligd geladen.", "success");
  } catch (error) {
    elements.accessPasswordError.textContent = "Beveiligde data kon niet geopend worden. Controleer de opslag of importeer een backup.";
    showToast("Toegang mislukt", "De beveiligde lokale opslag kon niet worden geopend.", "error");
  }
}

function bindAppEvents() {
  if (appEventsBound) {
    return;
  }

  appEventsBound = true;
  elements.form.addEventListener("submit", handleSubmit);
  elements.form.addEventListener("reset", handleReset);
  elements.storageLocation.addEventListener("change", handleLocationSelectChange);
  elements.customerName.addEventListener("input", handleCustomerNameInput);
  elements.customerName.addEventListener("blur", () => {
    window.setTimeout(hideCustomerSuggestions, 150);
  });
  elements.customerSuggestions.addEventListener("click", handleSuggestionClick);
  elements.locationGrid.addEventListener("click", handleLocationGridClick);
  elements.locationSetDetails.addEventListener("click", handleLocationSetDetailsClick);
  elements.registrationsBody.addEventListener("click", handleTableAction);
  elements.searchInput.addEventListener("input", renderTable);
  elements.ageFilter.addEventListener("change", renderTable);
  elements.backupDownload.addEventListener("click", downloadBackup);
  elements.backupImport.addEventListener("click", () => elements.backupImportInput.click());
  elements.backupImportInput.addEventListener("change", handleBackupFileSelected);
  elements.jsonOpen.addEventListener("click", openJsonModal);
  elements.closeJsonModal.addEventListener("click", closeJsonModal);
  elements.jsonModal.addEventListener("click", handleJsonBackdropClick);
  elements.jsonAuthForm.addEventListener("submit", handleJsonLogin);
  elements.jsonSnapshotBody.addEventListener("click", handleJsonSnapshotAction);
  elements.trashOpen.addEventListener("click", openTrashModal);
  elements.closeTrashModal.addEventListener("click", closeTrashModal);
  elements.trashModal.addEventListener("click", handleTrashBackdropClick);
  elements.trashAuthForm.addEventListener("submit", handleTrashLogin);
  elements.trashSearchInput.addEventListener("input", renderTrashTable);
  elements.trashAgeFilter.addEventListener("change", renderTrashTable);
  elements.trashBody.addEventListener("click", handleTrashAction);
  elements.closeModal.addEventListener("click", closeDetails);
  elements.detailModal.addEventListener("click", handleModalBackdropClick);

  fields.forEach((fieldName) => {
    const field = elements[fieldName];
    if (!field) {
      return;
    }

    field.addEventListener("input", () => clearFieldError(fieldName));
    field.addEventListener("change", () => clearFieldError(fieldName));
    field.addEventListener("input", scheduleFormDraftSave);
    field.addEventListener("change", scheduleFormDraftSave);
  });
}

function createLocations() {
  const result = [];

  for (let letterIndex = 0; letterIndex < TOTAL_LETTERS; letterIndex += 1) {
    const letter = String.fromCharCode(65 + letterIndex);
    for (let spot = 1; spot <= SPOTS_PER_LETTER; spot += 1) {
      result.push(`${letter}${spot}`);
    }
  }

  return result;
}

function readStorage(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    localStorage.removeItem(key);
    return [];
  }
}

async function loadSecureState() {
  const encryptedPayload = localStorage.getItem(SECURE_DATA_KEY);

  if (encryptedPayload) {
    const decrypted = await decryptJson(encryptedPayload);
    return {
      registrations: Array.isArray(decrypted.registrations) ? decrypted.registrations : [],
      customers: Array.isArray(decrypted.customers) ? decrypted.customers : [],
      trash: Array.isArray(decrypted.trash) ? decrypted.trash : [],
      formDraft: decrypted.formDraft && typeof decrypted.formDraft === "object" ? decrypted.formDraft : {},
      jsonSnapshots: Array.isArray(decrypted.jsonSnapshots) ? decrypted.jsonSnapshots : []
    };
  }

  return {
    registrations: readStorage(REGISTRATIONS_KEY),
    customers: readStorage(CUSTOMERS_KEY),
    trash: readStorage(TRASH_KEY),
    formDraft: {},
    jsonSnapshots: []
  };
}

async function persistAll() {
  if (!securityKey) {
    return;
  }

  const payload = {
    version: BACKUP_VERSION,
    savedAt: new Date().toISOString(),
    registrations,
    customers,
    trash: trashRegistrations,
    formDraft,
    jsonSnapshots
  };

  localStorage.setItem(SECURE_DATA_KEY, await encryptJson(payload));
  localStorage.removeItem(REGISTRATIONS_KEY);
  localStorage.removeItem(CUSTOMERS_KEY);
  localStorage.removeItem(TRASH_KEY);
}

async function verifyPassword(password, area, expectedHash) {
  const actualHash = await hashText(`${SECURITY_SCOPE}|${area}|${password}`);
  return actualHash === expectedHash;
}

async function hashText(value) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function deriveStorageKey(password) {
  const salt = getOrCreateSalt();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 150000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function getOrCreateSalt() {
  const storedSalt = localStorage.getItem(SECURE_SALT_KEY);
  if (storedSalt) {
    return base64ToBytes(storedSalt);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(SECURE_SALT_KEY, bytesToBase64(salt));
  return salt;
}

async function encryptJson(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, securityKey, encoded);

  return JSON.stringify({
    version: BACKUP_VERSION,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  });
}

async function decryptJson(value) {
  const parsed = JSON.parse(value);
  const iv = base64ToBytes(parsed.iv);
  const data = base64ToBytes(parsed.data);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, securityKey, data);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function cleanRegistrations(items) {
  const cleaned = [];
  const usedSets = new Set();

  items
    .filter((item) => item && typeof item === "object")
    .forEach((item) => {
      const registration = normalizeRegistration(item, usedSets);
      if (!registration) {
        return;
      }

      usedSets.add(createSetKey(registration.storageLocation, registration.setNumber));
      cleaned.push(registration);
    });

  return cleaned.sort(compareRegistrationsByStorage);
}

function cleanTrashRegistrations(items) {
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const registration = normalizeRegistration(item);
      if (!registration) {
        return null;
      }

      return {
        ...registration,
        deletedAt: item.deletedAt || new Date().toISOString()
      };
    })
    .filter(Boolean)
    .sort(compareDeletedRegistrations);
}

function normalizeRegistration(item, usedSets = null) {
  const storageLocation = cleanText(item.storageLocation).toUpperCase();
  if (!locations.includes(storageLocation)) {
    return null;
  }

  let setNumber = Number.parseInt(item.setNumber, 10);

  if (usedSets) {
    const setKey = createSetKey(storageLocation, setNumber);
    if (!isValidSetNumber(setNumber) || usedSets.has(setKey)) {
      setNumber = findFirstFreeSetNumberInUsed(storageLocation, usedSets);
    }

    if (!setNumber) {
      return null;
    }
  } else if (!isValidSetNumber(setNumber)) {
    setNumber = 1;
  }

  const registration = {
    id: String(item.id || createId()),
    customerName: cleanText(item.customerName),
    customerEmail: cleanText(item.customerEmail),
    customerPhone: cleanText(item.customerPhone),
    licensePlate: cleanText(item.licensePlate).toUpperCase(),
    carType: cleanText(item.carType),
    tireProfile: cleanText(item.tireProfile),
    tireBrand: cleanText(item.tireBrand),
    tireName: cleanText(item.tireName),
    tireSeason: normalizeTireSeason(item.tireSeason),
    storageLocation,
    setNumber,
    checkinDate: item.checkinDate || new Date().toISOString()
  };

  if (!registration.customerName || !registration.licensePlate) {
    return null;
  }

  return registration;
}

function cleanCustomers(items) {
  const byName = new Map();

  items
    .filter((item) => item && typeof item === "object")
    .forEach((item) => {
      const customer = {
        customerName: cleanText(item.customerName),
        customerEmail: cleanText(item.customerEmail),
        customerPhone: cleanText(item.customerPhone),
        licensePlate: cleanText(item.licensePlate).toUpperCase(),
        carType: cleanText(item.carType)
      };
      const key = normalize(customer.customerName);

      if (key) {
        byName.set(key, customer);
      }
    });

  return Array.from(byName.values()).sort(compareCustomerNames);
}

function deriveCustomersFromRegistrations(items) {
  return items.map((item) => ({
    customerName: item.customerName,
    customerEmail: item.customerEmail,
    customerPhone: item.customerPhone,
    licensePlate: item.licensePlate,
    carType: item.carType
  }));
}

function cleanFormDraft(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const draft = {};
  fields.forEach((fieldName) => {
    draft[fieldName] = cleanText(value[fieldName]);
  });

  return hasDraftContent(draft) ? draft : {};
}

function cleanJsonSnapshots(items) {
  return items
    .filter((item) => item && typeof item === "object" && item.payload && typeof item.payload === "object")
    .map((item) => ({
      id: cleanText(item.id) || createId(),
      createdAt: item.createdAt || new Date().toISOString(),
      reason: cleanText(item.reason) || "Automatisch opgeslagen",
      fileName: cleanText(item.fileName) || createSnapshotFileName("snapshot", new Date().toISOString()),
      payload: item.payload
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 30);
}

function hasDraftContent(draft) {
  return Object.values(draft || {}).some((value) => cleanText(value));
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase();
}

function normalizeTireSeason(value) {
  const cleaned = cleanText(value);

  if (TIRE_SEASONS.includes(cleaned)) {
    return cleaned;
  }

  const lowerValue = cleaned.toLowerCase();
  if (lowerValue.includes("winter")) {
    return "Winterbanden";
  }

  return "Zomerbanden";
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createSetKey(location, setNumber) {
  return `${location}-${setNumber}`;
}

function isValidSetNumber(value) {
  return Number.isInteger(value) && value >= 1 && value <= SETS_PER_LOCATION;
}

function findFirstFreeSetNumberInUsed(location, usedSets) {
  for (let setNumber = 1; setNumber <= SETS_PER_LOCATION; setNumber += 1) {
    if (!usedSets.has(createSetKey(location, setNumber))) {
      return setNumber;
    }
  }

  return null;
}

async function handleSubmit(event) {
  event.preventDefault();

  const formData = getFormData();
  const validation = validateRegistration(formData);

  if (!validation.isValid) {
    showToast("Fout bij validatie", "Controleer de gemarkeerde velden.", "error");
    return;
  }

  const setNumber = getFirstFreeSetNumber(formData.storageLocation);
  if (!setNumber) {
    setFieldError("storageLocation", "Deze locatie is vol.");
    showToast("Locatie is vol", `${formData.storageLocation} heeft geen vrije set-plek meer.`, "warning");
    return;
  }

  const registration = {
    id: createId(),
    ...formData,
    setNumber,
    checkinDate: new Date().toISOString()
  };

  registrations.push(registration);
  registrations.sort(compareRegistrationsByStorage);
  upsertCustomer(formData);
  formDraft = {};
  jsonSnapshots = jsonSnapshots.filter((snapshot) => snapshot.id !== "form-draft");
  createJsonSnapshot("Nieuwe registratie ingecheckt");
  await persistAll();
  prepareBackupDownload();

  activeLocation = registration.storageLocation;
  selectedLocation = "";
  elements.form.reset();
  hideCustomerSuggestions();
  renderAll();
  showToast(
    "Succesvol ingecheckt",
    `${registration.customerName} is gekoppeld aan ${registration.storageLocation} - Set ${registration.setNumber}. Backup is klaargezet.`,
    "success"
  );
}

function handleReset() {
  window.setTimeout(async () => {
    selectedLocation = "";
    clearAllErrors();
    hideCustomerSuggestions();
    await clearFormDraft();
    renderAll();
  }, 0);
}

function handleLocationSelectChange() {
  const location = elements.storageLocation.value;

  if (location && isLocationFull(location)) {
    elements.storageLocation.value = "";
    selectedLocation = "";
    activeLocation = location;
    showToast("Locatie is vol", `${location} heeft al ${SETS_PER_LOCATION}/${SETS_PER_LOCATION} sets.`, "warning");
    renderAll();
    return;
  }

  selectedLocation = location;
  activeLocation = location || activeLocation;
  renderLocationGrid();
  renderLocationSetDetails();
}

function handleCustomerNameInput() {
  const value = elements.customerName.value;
  clearFieldError("customerName");
  renderCustomerSuggestions(value);

  const exactCustomer = findCustomerByName(value);
  if (!exactCustomer) {
    lastAutoFilledCustomer = "";
    return;
  }

  if (normalize(exactCustomer.customerName) !== normalize(lastAutoFilledCustomer)) {
    fillCustomerFields(exactCustomer);
  }
}

function handleSuggestionClick(event) {
  const button = event.target.closest("button[data-customer-name]");
  if (!button) {
    return;
  }

  const customer = findCustomerByName(button.dataset.customerName);
  if (customer) {
    elements.customerName.value = customer.customerName;
    fillCustomerFields(customer);
    hideCustomerSuggestions();
  }
}

function fillCustomerFields(customer) {
  elements.customerEmail.value = customer.customerEmail;
  elements.customerPhone.value = customer.customerPhone;
  elements.licensePlate.value = customer.licensePlate;
  elements.carType.value = customer.carType;
  lastAutoFilledCustomer = customer.customerName;

  ["customerEmail", "customerPhone", "licensePlate", "carType"].forEach(clearFieldError);
  scheduleFormDraftSave();
  showToast("Klantgegevens automatisch ingevuld", `${customer.customerName} is gevonden in de klantenlijst.`, "success");
}

function renderCustomerSuggestions(value) {
  const query = normalize(value);
  elements.customerSuggestions.innerHTML = "";

  if (!query) {
    hideCustomerSuggestions();
    return;
  }

  const matches = customers
    .filter((customer) => normalize(customer.customerName).includes(query))
    .slice(0, 6);

  if (!matches.length) {
    hideCustomerSuggestions();
    return;
  }

  const fragment = document.createDocumentFragment();
  matches.forEach((customer) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.customerName = customer.customerName;
    button.innerHTML = `
      ${escapeHtml(customer.customerName)}
      <span>${escapeHtml(customer.licensePlate || "Geen kenteken")} - ${escapeHtml(customer.carType || "Geen type auto")}</span>
    `;
    item.appendChild(button);
    fragment.appendChild(item);
  });

  elements.customerSuggestions.appendChild(fragment);
  elements.customerSuggestions.classList.add("is-visible");
}

function hideCustomerSuggestions() {
  elements.customerSuggestions.classList.remove("is-visible");
}

function findCustomerByName(name) {
  const target = normalize(name);
  return customers.find((customer) => normalize(customer.customerName) === target);
}

function upsertCustomer(data) {
  const target = normalize(data.customerName);
  const nextCustomer = {
    customerName: data.customerName,
    customerEmail: data.customerEmail,
    customerPhone: data.customerPhone,
    licensePlate: data.licensePlate,
    carType: data.carType
  };

  const existingIndex = customers.findIndex((customer) => normalize(customer.customerName) === target);

  if (existingIndex >= 0) {
    customers[existingIndex] = nextCustomer;
  } else {
    customers.push(nextCustomer);
  }

  customers.sort(compareCustomerNames);
}

function compareCustomerNames(a, b) {
  return a.customerName.localeCompare(b.customerName, "nl", { sensitivity: "base" });
}

function getFormData() {
  return {
    customerName: cleanText(elements.customerName.value),
    customerEmail: cleanText(elements.customerEmail.value),
    customerPhone: cleanText(elements.customerPhone.value),
    licensePlate: cleanText(elements.licensePlate.value).toUpperCase(),
    carType: cleanText(elements.carType.value),
    tireProfile: cleanText(elements.tireProfile.value),
    tireBrand: cleanText(elements.tireBrand.value),
    tireName: cleanText(elements.tireName.value),
    tireSeason: cleanText(elements.tireSeason.value),
    storageLocation: cleanText(elements.storageLocation.value).toUpperCase()
  };
}

function collectFormDraft() {
  return cleanFormDraft(getFormData());
}

function restoreFormDraft() {
  if (!hasDraftContent(formDraft)) {
    return;
  }

  fields.forEach((fieldName) => {
    if (!elements[fieldName] || typeof formDraft[fieldName] === "undefined") {
      return;
    }

    elements[fieldName].value = formDraft[fieldName];
  });

  if (formDraft.storageLocation && !isLocationFull(formDraft.storageLocation)) {
    selectedLocation = formDraft.storageLocation;
    activeLocation = formDraft.storageLocation;
    renderStorageOptions();
    renderLocationGrid();
    renderLocationSetDetails();
  }

  showToast("Concept hersteld", "Automatisch opgeslagen invoer is teruggezet.", "success");
}

function scheduleFormDraftSave() {
  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(saveFormDraft, 450);
}

async function saveFormDraft() {
  try {
    formDraft = collectFormDraft();
    if (hasDraftContent(formDraft)) {
      upsertJsonSnapshot("Automatische formulieropslag", "form-draft");
    } else {
      jsonSnapshots = jsonSnapshots.filter((snapshot) => snapshot.id !== "form-draft");
    }
    await persistAll();
    renderJsonSnapshots();
  } catch (error) {
    showToast("Automatisch opslaan mislukt", "De ingevoerde informatie kon niet veilig worden opgeslagen.", "error");
  }
}

async function clearFormDraft() {
  formDraft = {};
  jsonSnapshots = jsonSnapshots.filter((snapshot) => snapshot.id !== "form-draft");
  await persistAll();
  renderJsonSnapshots();
}

function validateRegistration(data) {
  clearAllErrors();
  let isValid = true;

  const requiredFields = [
    ["customerName", "Naam klant is verplicht."],
    ["customerEmail", "E-mailadres is verplicht."],
    ["customerPhone", "Telefoonnummer is verplicht."],
    ["licensePlate", "Kenteken is verplicht."],
    ["carType", "Type auto is verplicht."],
    ["tireProfile", "Profiel is verplicht."],
    ["tireBrand", "Merk band is verplicht."],
    ["tireName", "Band naam is verplicht."],
    ["tireSeason", "Kies Zomerbanden of Winterbanden."],
    ["storageLocation", "Kies een opslaglocatie."]
  ];

  requiredFields.forEach(([fieldName, message]) => {
    if (!data[fieldName]) {
      setFieldError(fieldName, message);
      isValid = false;
    }
  });

  if (data.customerEmail && !isValidEmail(data.customerEmail)) {
    setFieldError("customerEmail", "Vul een geldig e-mailadres in.");
    isValid = false;
  }

  if (data.customerPhone && !isValidPhone(data.customerPhone)) {
    setFieldError("customerPhone", "Vul een logisch telefoonnummer in.");
    isValid = false;
  }

  if (data.tireSeason && !TIRE_SEASONS.includes(data.tireSeason)) {
    setFieldError("tireSeason", "Kies Zomerbanden of Winterbanden.");
    isValid = false;
  }

  if (data.storageLocation && !locations.includes(data.storageLocation)) {
    setFieldError("storageLocation", "Deze opslaglocatie bestaat niet.");
    isValid = false;
  }

  if (data.storageLocation && isLocationFull(data.storageLocation)) {
    setFieldError("storageLocation", "Deze opslaglocatie is vol.");
    showToast("Locatie is vol", `${data.storageLocation} heeft al ${SETS_PER_LOCATION}/${SETS_PER_LOCATION} sets.`, "warning");
    isValid = false;
  }

  return { isValid };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function isValidPhone(value) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function setFieldError(fieldName, message) {
  const field = elements[fieldName];
  const error = document.getElementById(`${fieldName}Error`);

  if (field) {
    field.setAttribute("aria-invalid", "true");
  }

  if (error) {
    error.textContent = message;
  }
}

function clearFieldError(fieldName) {
  const field = elements[fieldName];
  const error = document.getElementById(`${fieldName}Error`);

  if (field) {
    field.removeAttribute("aria-invalid");
  }

  if (error) {
    error.textContent = "";
  }
}

function clearAllErrors() {
  fields.forEach(clearFieldError);
}

function renderAll() {
  renderDashboard();
  renderStorageOptions();
  renderLocationGrid();
  renderLocationSetDetails();
  renderTable();
  renderTrashTable();
}

function renderDashboard() {
  const occupied = registrations.length;
  const free = TOTAL_SET_SLOTS - occupied;
  const percentage = TOTAL_SET_SLOTS ? Math.round((occupied / TOTAL_SET_SLOTS) * 100) : 0;

  elements.totalSlots.textContent = String(locations.length);
  elements.totalSetSlots.textContent = String(TOTAL_SET_SLOTS);
  elements.occupiedSlots.textContent = String(occupied);
  elements.freeSlots.textContent = String(free);
  elements.occupancyRate.textContent = `${percentage}%`;
}

function renderStorageOptions() {
  const currentValue = selectedLocation || elements.storageLocation.value;
  const availableLocations = locations.filter((location) => !isLocationFull(location));

  elements.storageLocation.innerHTML = "";
  elements.storageLocation.appendChild(createOption("", "Kies een locatie met vrije set-plek"));

  availableLocations.forEach((location) => {
    const count = getLocationCount(location);
    const firstFreeSet = getFirstFreeSetNumber(location);
    elements.storageLocation.appendChild(createOption(location, `${location} (${count}/6 bezet - Set ${firstFreeSet} eerst vrij)`));
  });

  if (currentValue && availableLocations.includes(currentValue)) {
    elements.storageLocation.value = currentValue;
  } else {
    selectedLocation = "";
    elements.storageLocation.value = "";
  }

  elements.storageLocation.disabled = availableLocations.length === 0;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function renderLocationGrid() {
  const fragment = document.createDocumentFragment();
  elements.locationGrid.innerHTML = "";

  locations.forEach((location) => {
    const locationRegistrations = getRegistrationsByLocation(location);
    const count = locationRegistrations.length;
    const isSelected = selectedLocation === location;
    const isFull = count >= SETS_PER_LOCATION;
    const ageStatus = getStrongestAgeStatus(locationRegistrations);
    const locationStatus = getLocationStatus(count);
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "location-card",
      locationStatus.cardClass,
      ageStatus.locationClass,
      isSelected ? "is-selected" : ""
    ].filter(Boolean).join(" ");
    button.dataset.location = location;
    button.setAttribute(
      "aria-label",
      `${location}: ${count}/6 bezet. ${isFull ? "Vol, details bekijken." : "Locatie selecteren en sets bekijken."}`
    );

    const statusClass = isSelected ? "status-selected" : locationStatus.badgeClass;
    const statusLabel = isSelected ? "Geselecteerd" : locationStatus.label;
    const firstFree = getFirstFreeSetNumber(location);
    const meta = isFull ? `${count}/6 vol` : `${count}/6 bezet${firstFree ? ` - Set ${firstFree} vrij` : ""}`;
    const fillWidth = Math.round((count / SETS_PER_LOCATION) * 100);

    button.innerHTML = `
      <span class="location-code">${location}</span>
      <span class="location-meta">${escapeHtml(meta)}</span>
      <span class="capacity-bar" aria-hidden="true"><span class="capacity-fill" style="width: ${fillWidth}%"></span></span>
      <span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
    `;

    fragment.appendChild(button);
  });

  elements.locationGrid.appendChild(fragment);
}

function renderLocationSetDetails() {
  elements.locationSetDetails.innerHTML = "";

  if (!activeLocation) {
    elements.locationSetDetails.innerHTML = `
      <strong>Selecteer een locatie</strong>
      <p>Hier zie je per locatie Set 1 tot en met Set 6.</p>
    `;
    return;
  }

  const locationRegistrations = getRegistrationsByLocation(activeLocation);
  const registrationsBySet = new Map(locationRegistrations.map((registration) => [registration.setNumber, registration]));
  const count = locationRegistrations.length;
  const firstFree = getFirstFreeSetNumber(activeLocation);
  const title = document.createElement("strong");
  title.textContent = `${activeLocation} gegevens klant`;
  const summary = document.createElement("p");
  summary.textContent = `${count}/6 set-plekken bezet.`;
  const list = document.createElement("ol");
  list.className = "set-list";

  for (let setNumber = 1; setNumber <= SETS_PER_LOCATION; setNumber += 1) {
    const registration = registrationsBySet.get(setNumber);
    const item = document.createElement("li");
    item.className = "set-item";

    const setBadge = document.createElement("span");
    setBadge.className = "status-badge status-selected";
    setBadge.textContent = `Set ${setNumber}`;

    const name = document.createElement("div");
    name.className = "set-name";
    const strong = document.createElement("strong");
    const detail = document.createElement("span");
    name.append(strong, detail);

    if (registration) {
      const ageStatus = getAgeStatus(registration);
      if (ageStatus.locationClass) {
        item.classList.add(ageStatus.locationClass);
      }
      strong.textContent = registration.customerName;
      detail.textContent = `${registration.licensePlate} - ${registration.tireSeason} - ${registration.tireName || registration.tireBrand}`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-ghost";
      button.dataset.action = "details";
      button.dataset.id = registration.id;
      button.textContent = "Bekijk details";
      item.append(setBadge, name, button);
    } else {
      item.classList.add("is-empty");
      strong.textContent = "Lege plek beschikbaar";
      detail.textContent = "Deze set-plek is vrij.";
      item.append(setBadge, name);
    }

    list.appendChild(item);
  }

  const note = document.createElement("p");
  note.className = "set-note";
  if (firstFree && selectedLocation === activeLocation) {
    note.textContent = `Nieuwe registratie wordt automatisch opgeslagen op ${activeLocation} - Set ${firstFree}.`;
  } else if (firstFree) {
    note.textContent = `${activeLocation} heeft nog ${SETS_PER_LOCATION - count} vrije set-plekken.`;
  } else {
    note.textContent = `${activeLocation} is vol. Kies een andere locatie voor nieuwe incheckregistraties.`;
  }

  elements.locationSetDetails.append(title, summary, list, note);
}

function handleLocationGridClick(event) {
  const button = event.target.closest("button[data-location]");
  if (!button) {
    return;
  }

  const location = button.dataset.location;
  activeLocation = location;

  if (isLocationFull(location)) {
    if (selectedLocation === location) {
      selectedLocation = "";
      elements.storageLocation.value = "";
    }

    renderAll();
    showToast("Locatie is vol", `${location} is vol, maar de klantsets zijn hieronder zichtbaar.`, "warning");
    return;
  }

  selectedLocation = location;
  clearFieldError("storageLocation");
  renderStorageOptions();
  renderLocationGrid();
  renderLocationSetDetails();
  showToast("Opslaglocatie geselecteerd", `${location} staat klaar in het formulier.`, "success");
}

function handleLocationSetDetailsClick(event) {
  const button = event.target.closest("button[data-action='details']");
  if (!button) {
    return;
  }

  showDetails(button.dataset.id);
}

function renderTable() {
  const sorted = getSortedRegistrations();
  const query = normalize(elements.searchInput.value);
  const ageFilter = elements.ageFilter.value;
  const filtered = sorted.filter((registration) => matchesSearch(registration, query) && matchesAgeFilter(registration, ageFilter));
  const noResultKey = `${query}|${ageFilter}`;

  elements.registrationsBody.innerHTML = "";

  if (!filtered.length) {
    const hasFilter = query || ageFilter !== "all";
    elements.emptyState.querySelector("strong").textContent = hasFilter ? "Geen zoekresultaten gevonden." : "Nog geen banden ingecheckt.";
    elements.emptyState.querySelector("p").textContent = hasFilter
      ? "Pas de zoekopdracht of het ligduurfilter aan."
      : "Gebruik het formulier om de eerste registratie toe te voegen.";
    elements.emptyState.classList.add("is-visible");

    if (hasFilter && lastNoResultsQuery !== noResultKey) {
      showToast("Geen zoekresultaten gevonden", "Er zijn geen registraties die passen bij je filter.", "warning");
      lastNoResultsQuery = noResultKey;
    }
    return;
  }

  elements.emptyState.classList.remove("is-visible");
  if (query || ageFilter !== "all") {
    lastNoResultsQuery = "";
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((registration) => {
    const ageStatus = getAgeStatus(registration);
    const row = document.createElement("tr");
    row.className = ageStatus.rowClass;
    row.innerHTML = `
      <td><span class="status-badge status-selected">${escapeHtml(registration.storageLocation)}</span></td>
      <td><span class="status-badge status-normal">Set ${registration.setNumber}</span></td>
      <td>${escapeHtml(registration.customerName)}</td>
      <td>${escapeHtml(registration.customerEmail)}</td>
      <td>${escapeHtml(registration.customerPhone)}</td>
      <td>${escapeHtml(registration.licensePlate)}</td>
      <td>${escapeHtml(registration.carType)}</td>
      <td>${escapeHtml(registration.tireProfile)}</td>
      <td>${escapeHtml(registration.tireBrand)}</td>
      <td>${escapeHtml(registration.tireName)}</td>
      <td>${escapeHtml(registration.tireSeason)}</td>
      <td><span class="status-badge ${ageStatus.badgeClass}">${escapeHtml(ageStatus.label)}</span></td>
      <td>${formatDate(registration.checkinDate)}</td>
      <td>
        <div class="action-group">
          <button class="btn btn-ghost" type="button" data-action="details" data-id="${escapeHtml(registration.id)}">Bekijk details</button>
          <button class="btn btn-danger" type="button" data-action="delete" data-id="${escapeHtml(registration.id)}">Verwijder</button>
        </div>
      </td>
    `;
    fragment.appendChild(row);
  });

  elements.registrationsBody.appendChild(fragment);
}

function getSortedRegistrations() {
  return [...registrations].sort(compareRegistrationsByStorage);
}

function compareRegistrationsByStorage(a, b) {
  const locationDiff = getLocationIndex(a.storageLocation) - getLocationIndex(b.storageLocation);
  if (locationDiff !== 0) {
    return locationDiff;
  }

  return a.setNumber - b.setNumber;
}

function compareDeletedRegistrations(a, b) {
  return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime();
}

function getLocationIndex(location) {
  return locations.indexOf(location);
}

function matchesSearch(registration, query) {
  if (!query) {
    return true;
  }

  const searchable = [
    registration.customerName,
    registration.licensePlate,
    registration.storageLocation,
    `Set ${registration.setNumber}`,
    registration.tireBrand,
    registration.tireName,
    registration.tireSeason,
    registration.carType,
    registration.customerPhone
  ].join(" ");

  return normalize(searchable).includes(query);
}

function matchesAgeFilter(registration, filterValue) {
  const ageStatus = getAgeStatus(registration);

  if (filterValue === "year") {
    return ageStatus.key === "year";
  }

  if (filterValue === "six") {
    return ageStatus.key === "six" || ageStatus.key === "year";
  }

  return true;
}

function handleTableAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === "details") {
    showDetails(id);
  }

  if (action === "delete") {
    deleteRegistration(id);
  }
}

function showDetails(id) {
  const registration = registrations.find((item) => item.id === id);
  if (!registration) {
    return;
  }

  showRegistrationDetails(registration);
}

function showRegistrationDetails(registration, extraItems = []) {
  const ageStatus = getAgeStatus(registration);
  elements.modalTitle.textContent = `${registration.customerName} - ${registration.storageLocation} Set ${registration.setNumber}`;
  elements.modalDetails.innerHTML = "";

  const detailItems = [
    ...extraItems,
    ["Naam klant", registration.customerName],
    ["E-mailadres", registration.customerEmail],
    ["Telefoonnummer", registration.customerPhone],
    ["Kenteken", registration.licensePlate],
    ["Type auto", registration.carType],
    ["Profiel", registration.tireProfile],
    ["Merk band", registration.tireBrand],
    ["Band naam", registration.tireName],
    ["Bandensoort", registration.tireSeason],
    ["Opslaglocatie", registration.storageLocation],
    ["Setnummer binnen locatie", `Set ${registration.setNumber}`],
    ["Datum van inchecken", formatDate(registration.checkinDate)]
  ];

  const fragment = document.createDocumentFragment();
  appendDetailItem(fragment, "Ligduur", ageStatus.label, ageStatus.badgeClass);
  detailItems.forEach(([label, value, badgeClass]) => appendDetailItem(fragment, label, value, badgeClass));

  elements.modalDetails.appendChild(fragment);
  elements.detailModal.showModal();
  elements.closeModal.focus();
}

function appendDetailItem(fragment, label, value, badgeClass = "") {
  const wrapper = document.createElement("dl");
  wrapper.className = "detail-item";
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;

  if (badgeClass) {
    const badge = document.createElement("span");
    badge.className = `status-badge ${badgeClass}`;
    badge.textContent = value;
    description.appendChild(badge);
  } else {
    description.textContent = value;
  }

  wrapper.append(term, description);
  fragment.appendChild(wrapper);
}

function closeDetails() {
  elements.detailModal.close();
}

function handleModalBackdropClick(event) {
  if (event.target === elements.detailModal) {
    closeDetails();
  }
}

async function deleteRegistration(id) {
  const registration = registrations.find((item) => item.id === id);
  if (!registration) {
    return;
  }

  const confirmed = window.confirm(
    `Registratie voor ${registration.customerName} op ${registration.storageLocation} - Set ${registration.setNumber} naar de prullenbak verplaatsen?`
  );
  if (!confirmed) {
    return;
  }

  trashRegistrations.unshift({
    ...registration,
    deletedAt: new Date().toISOString()
  });
  registrations = registrations.filter((item) => item.id !== id);
  createJsonSnapshot("Registratie naar prullenbak verplaatst");
  await persistAll();
  prepareBackupDownload();

  if (elements.detailModal.open) {
    closeDetails();
  }

  if (activeLocation === registration.storageLocation) {
    activeLocation = registration.storageLocation;
  }

  renderAll();
  showToast("Registratie verplaatst", `${registration.storageLocation} - Set ${registration.setNumber} staat nu in de beveiligde prullenbak.`, "success");
}

function openTrashModal() {
  if (trashUnlocked) {
    showTrashContent();
  } else {
    elements.trashAuthForm.hidden = false;
    elements.trashContent.hidden = true;
    elements.trashPassword.value = "";
    elements.trashPasswordError.textContent = "";
  }

  elements.trashModal.showModal();
  (trashUnlocked ? elements.trashSearchInput : elements.trashPassword).focus();
}

function closeTrashModal() {
  elements.trashModal.close();
}

function handleTrashBackdropClick(event) {
  if (event.target === elements.trashModal) {
    closeTrashModal();
  }
}

async function handleTrashLogin(event) {
  event.preventDefault();
  elements.trashPasswordError.textContent = "";

  const isValid = await verifyPassword(elements.trashPassword.value, "trash", TRASH_PASSWORD_HASH);
  if (!isValid) {
    elements.trashPasswordError.textContent = "Prullenbakwachtwoord is onjuist.";
    elements.trashPassword.setAttribute("aria-invalid", "true");
    return;
  }

  trashUnlocked = true;
  elements.trashPassword.value = "";
  elements.trashPassword.removeAttribute("aria-invalid");
  showTrashContent();
  showToast("Prullenbak geopend", "Verwijderde registraties zijn beveiligd geladen.", "success");
}

function showTrashContent() {
  elements.trashAuthForm.hidden = true;
  elements.trashContent.hidden = false;
  renderTrashTable();
}

function renderTrashTable() {
  if (!trashUnlocked || !elements.trashBody) {
    return;
  }

  const query = normalize(elements.trashSearchInput.value);
  const ageFilter = elements.trashAgeFilter.value;
  const filtered = [...trashRegistrations]
    .sort(compareDeletedRegistrations)
    .filter((registration) => matchesSearch(registration, query) && matchesAgeFilter(registration, ageFilter));

  elements.trashBody.innerHTML = "";

  if (!filtered.length) {
    const hasFilter = query || ageFilter !== "all";
    elements.trashEmptyState.querySelector("strong").textContent = hasFilter ? "Geen verwijderde registraties gevonden." : "Prullenbak is leeg";
    elements.trashEmptyState.querySelector("p").textContent = hasFilter
      ? "Pas de zoekopdracht of het ligduurfilter aan."
      : "Verwijderde registraties verschijnen hier na wachtwoordcontrole.";
    elements.trashEmptyState.classList.add("is-visible");
    return;
  }

  elements.trashEmptyState.classList.remove("is-visible");
  const fragment = document.createDocumentFragment();

  filtered.forEach((registration) => {
    const ageStatus = getAgeStatus(registration);
    const row = document.createElement("tr");
    row.className = ageStatus.rowClass;
    row.innerHTML = `
      <td><span class="status-badge status-deleted">Verwijderd</span></td>
      <td>${formatDate(registration.deletedAt)}</td>
      <td><span class="status-badge status-selected">${escapeHtml(registration.storageLocation)}</span></td>
      <td><span class="status-badge status-normal">Set ${registration.setNumber}</span></td>
      <td>${escapeHtml(registration.customerName)}</td>
      <td>${escapeHtml(registration.customerEmail)}</td>
      <td>${escapeHtml(registration.customerPhone)}</td>
      <td>${escapeHtml(registration.licensePlate)}</td>
      <td>${escapeHtml(registration.carType)}</td>
      <td>${escapeHtml(registration.tireProfile)}</td>
      <td>${escapeHtml(registration.tireBrand)}</td>
      <td>${escapeHtml(registration.tireName)}</td>
      <td>${escapeHtml(registration.tireSeason)}</td>
      <td><span class="status-badge ${ageStatus.badgeClass}">${escapeHtml(ageStatus.label)}</span></td>
      <td>${formatDate(registration.checkinDate)}</td>
      <td>
        <button class="btn btn-danger" type="button" data-action="permanent-delete" data-id="${escapeHtml(registration.id)}" data-deleted-at="${escapeHtml(registration.deletedAt)}">Definitief verwijderen</button>
      </td>
    `;
    fragment.appendChild(row);
  });

  elements.trashBody.appendChild(fragment);
}

function handleTrashAction(event) {
  const button = event.target.closest("button[data-action='permanent-delete']");
  if (!button) {
    return;
  }

  permanentlyDeleteTrashRegistration(button.dataset.id, button.dataset.deletedAt);
}

async function permanentlyDeleteTrashRegistration(id, deletedAt) {
  const registration = trashRegistrations.find((item) => item.id === id && item.deletedAt === deletedAt);
  if (!registration) {
    return;
  }

  const confirmed = window.confirm(
    `Registratie van ${registration.customerName} permanent verwijderen? Deze actie kan niet worden teruggedraaid.`
  );

  if (!confirmed) {
    return;
  }

  trashRegistrations = trashRegistrations.filter((item) => !(item.id === id && item.deletedAt === deletedAt));
  createJsonSnapshot("Registratie definitief verwijderd");
  await persistAll();
  prepareBackupDownload();
  renderTrashTable();
  showToast("Definitief verwijderd", "De registratie is permanent uit de prullenbak verwijderd.", "success");
}

function openJsonModal() {
  if (jsonUnlocked) {
    showJsonContent();
  } else {
    elements.jsonAuthForm.hidden = false;
    elements.jsonContent.hidden = true;
    elements.jsonPassword.value = "";
    elements.jsonPasswordError.textContent = "";
  }

  elements.jsonModal.showModal();
  (jsonUnlocked ? elements.jsonSnapshotBody : elements.jsonPassword).focus();
}

function closeJsonModal() {
  elements.jsonModal.close();
}

function handleJsonBackdropClick(event) {
  if (event.target === elements.jsonModal) {
    closeJsonModal();
  }
}

async function handleJsonLogin(event) {
  event.preventDefault();
  elements.jsonPasswordError.textContent = "";

  const isValid = await verifyPassword(elements.jsonPassword.value, "trash", TRASH_PASSWORD_HASH);
  if (!isValid) {
    elements.jsonPasswordError.textContent = "Wachtwoord is onjuist.";
    elements.jsonPassword.setAttribute("aria-invalid", "true");
    return;
  }

  jsonUnlocked = true;
  elements.jsonPassword.value = "";
  elements.jsonPassword.removeAttribute("aria-invalid");
  showJsonContent();
  showToast("JSON-bestanden geopend", "Automatisch opgeslagen JSON-bestanden zijn beveiligd geladen.", "success");
}

function showJsonContent() {
  elements.jsonAuthForm.hidden = true;
  elements.jsonContent.hidden = false;
  renderJsonSnapshots();
}

function renderJsonSnapshots() {
  if (!jsonUnlocked || !elements.jsonSnapshotBody) {
    return;
  }

  elements.jsonSnapshotBody.innerHTML = "";
  const sorted = [...jsonSnapshots].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (!sorted.length) {
    elements.jsonEmptyState.classList.add("is-visible");
    elements.jsonPreview.hidden = true;
    return;
  }

  elements.jsonEmptyState.classList.remove("is-visible");
  const fragment = document.createDocumentFragment();

  sorted.forEach((snapshot) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(snapshot.fileName)}</td>
      <td>${formatDate(snapshot.createdAt)}</td>
      <td>${escapeHtml(snapshot.reason)}</td>
      <td>
        <div class="snapshot-actions">
          <button class="btn btn-ghost" type="button" data-action="view-json" data-id="${escapeHtml(snapshot.id)}">Bekijken</button>
          <button class="btn btn-secondary" type="button" data-action="download-json" data-id="${escapeHtml(snapshot.id)}">Downloaden</button>
          <button class="btn btn-danger" type="button" data-action="delete-json" data-id="${escapeHtml(snapshot.id)}">Verwijderen</button>
        </div>
      </td>
    `;
    fragment.appendChild(row);
  });

  elements.jsonSnapshotBody.appendChild(fragment);
}

function handleJsonSnapshotAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const snapshot = jsonSnapshots.find((item) => item.id === button.dataset.id);
  if (!snapshot) {
    return;
  }

  if (button.dataset.action === "view-json") {
    elements.jsonPreview.hidden = false;
    elements.jsonPreview.textContent = JSON.stringify(snapshot.payload, null, 2);
  }

  if (button.dataset.action === "download-json") {
    downloadJsonSnapshot(snapshot);
  }

  if (button.dataset.action === "delete-json") {
    deleteJsonSnapshot(snapshot.id);
  }
}

function downloadJsonSnapshot(snapshot) {
  const blob = new Blob([JSON.stringify(snapshot.payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = snapshot.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function deleteJsonSnapshot(id) {
  const confirmed = window.confirm("Dit opgeslagen JSON-bestand verwijderen?");
  if (!confirmed) {
    return;
  }

  jsonSnapshots = jsonSnapshots.filter((snapshot) => snapshot.id !== id);
  await persistAll();
  elements.jsonPreview.hidden = true;
  renderJsonSnapshots();
  showToast("JSON-bestand verwijderd", "Het opgeslagen JSON-bestand is verwijderd.", "success");
}

function createJsonSnapshot(reason) {
  upsertJsonSnapshot(reason, createId());
}

function upsertJsonSnapshot(reason, id) {
  const createdAt = new Date().toISOString();
  const snapshot = {
    id,
    createdAt,
    reason,
    fileName: createSnapshotFileName(reason, createdAt),
    payload: buildSnapshotPayload(createdAt)
  };

  const existingIndex = jsonSnapshots.findIndex((item) => item.id === id);
  if (existingIndex >= 0) {
    jsonSnapshots[existingIndex] = snapshot;
  } else {
    jsonSnapshots.unshift(snapshot);
  }

  const draftSnapshots = jsonSnapshots.filter((item) => item.id === "form-draft");
  const regularSnapshots = jsonSnapshots.filter((item) => item.id !== "form-draft");
  jsonSnapshots = [
    ...draftSnapshots,
    ...regularSnapshots.slice(0, 30 - draftSnapshots.length)
  ];
}

function buildSnapshotPayload(exportedAt = new Date().toISOString()) {
  return {
    app: "Bandenservice Hardenberg",
    version: BACKUP_VERSION,
    exportedAt,
    totalLocations: locations.length,
    setsPerLocation: SETS_PER_LOCATION,
    registrations: getSortedRegistrations().map(toBackupRegistration),
    trash: trashRegistrations.map((registration) => ({
      ...toBackupRegistration(registration),
      deletedAt: registration.deletedAt
    })),
    customers,
    formDraft
  };
}

function createSnapshotFileName(reason, createdAt) {
  const stamp = createdAt.slice(0, 16).replace("T", "-").replace(":", "");
  const safeReason = normalize(reason)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "snapshot";

  return `bandenservice-hardenberg-${safeReason}-${stamp}.json`;
}

function getLocationCount(location) {
  return registrations.filter((registration) => registration.storageLocation === location).length;
}

function getRegistrationsByLocation(location) {
  return registrations
    .filter((registration) => registration.storageLocation === location)
    .sort((a, b) => a.setNumber - b.setNumber);
}

function isLocationFull(location) {
  return getLocationCount(location) >= SETS_PER_LOCATION;
}

function getFirstFreeSetNumber(location) {
  const usedSets = new Set(getRegistrationsByLocation(location).map((registration) => registration.setNumber));

  for (let setNumber = 1; setNumber <= SETS_PER_LOCATION; setNumber += 1) {
    if (!usedSets.has(setNumber)) {
      return setNumber;
    }
  }

  return null;
}

function getLocationStatus(count) {
  if (count === 0) {
    return {
      label: "Vrij",
      cardClass: "is-free",
      badgeClass: "status-free"
    };
  }

  if (count >= SETS_PER_LOCATION) {
    return {
      label: "Vol",
      cardClass: "is-full",
      badgeClass: "status-full"
    };
  }

  return {
    label: "Bezet",
    cardClass: "is-occupied",
    badgeClass: "status-occupied"
  };
}

function getAgeStatus(registration) {
  const date = new Date(registration.checkinDate);
  if (Number.isNaN(date.getTime())) {
    return createAgeStatus("normal");
  }

  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(now.getMonth() - 6);

  if (date < oneYearAgo) {
    return createAgeStatus("year");
  }

  if (date < sixMonthsAgo) {
    return createAgeStatus("six");
  }

  return createAgeStatus("normal");
}

function createAgeStatus(key) {
  const statuses = {
    normal: {
      key: "normal",
      label: "Normaal",
      badgeClass: "status-normal",
      rowClass: "",
      locationClass: ""
    },
    six: {
      key: "six",
      label: "Langer dan 6 maanden",
      badgeClass: "status-long-six",
      rowClass: "age-long-six",
      locationClass: "age-long-six"
    },
    year: {
      key: "year",
      label: "Langer dan 1 jaar",
      badgeClass: "status-long-year",
      rowClass: "age-long-year",
      locationClass: "age-long-year"
    }
  };

  return statuses[key] || statuses.normal;
}

function getStrongestAgeStatus(items) {
  if (items.some((item) => getAgeStatus(item).key === "year")) {
    return createAgeStatus("year");
  }

  if (items.some((item) => getAgeStatus(item).key === "six")) {
    return createAgeStatus("six");
  }

  return createAgeStatus("normal");
}

// Browsers mogen vanuit een lokale HTML-app niet stilletjes bestanden op disk opslaan.
// Daarom zet de app na wijzigingen een actuele backup klaar en downloadt pas na een gebruikersklik.
function prepareBackupDownload() {
  if (latestBackupUrl) {
    URL.revokeObjectURL(latestBackupUrl);
  }

  const payload = getBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  latestBackupUrl = URL.createObjectURL(blob);
  latestBackupFileName = createBackupFileName();
}

function getBackupPayload() {
  return {
    ...buildSnapshotPayload(),
    jsonSnapshots: jsonSnapshots.map((snapshot) => ({
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      reason: snapshot.reason,
      fileName: snapshot.fileName,
      payload: snapshot.payload
    }))
  };
}

function toBackupRegistration(registration) {
  return {
    id: registration.id,
    customerName: registration.customerName,
    customerEmail: registration.customerEmail,
    customerPhone: registration.customerPhone,
    licensePlate: registration.licensePlate,
    carType: registration.carType,
    tireProfile: registration.tireProfile,
    tireBrand: registration.tireBrand,
    tireName: registration.tireName,
    tireSeason: registration.tireSeason,
    storageLocation: registration.storageLocation,
    setNumber: registration.setNumber,
    checkinDate: registration.checkinDate
  };
}

function createBackupFileName() {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  return `bandenservice-hardenberg-backup-${stamp}.json`;
}

function downloadBackup() {
  prepareBackupDownload();

  const link = document.createElement("a");
  link.href = latestBackupUrl;
  link.download = latestBackupFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast("Backup downloaden", "De actuele JSON-backup wordt gedownload.", "success");
}

function handleBackupFileSelected(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    importBackup(String(reader.result || ""));
    elements.backupImportInput.value = "";
  });
  reader.addEventListener("error", () => {
    showToast("Import mislukt", "Het backupbestand kon niet gelezen worden.", "error");
    elements.backupImportInput.value = "";
  });
  reader.readAsText(file);
}

async function importBackup(fileContent) {
  let parsed;

  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    showToast("Import mislukt", "Dit is geen geldig JSON-bestand.", "error");
    return;
  }

  const extracted = extractBackupData(parsed);
  if (!extracted) {
    showToast("Import mislukt", "De backup bevat geen geldige registratielijst.", "error");
    return;
  }

  const overwrite = window.confirm(
    "Backup importeren: bestaande data overschrijven? Kies OK om te overschrijven. Kies Annuleren om samenvoegen te kiezen."
  );
  let shouldMerge = false;

  if (!overwrite) {
    shouldMerge = window.confirm("Backup samenvoegen met bestaande data?");
    if (!shouldMerge) {
      showToast("Import geannuleerd", "Er zijn geen gegevens aangepast.", "warning");
      return;
    }
  }

  const importedRegistrations = cleanRegistrations(extracted.registrations);
  const importedTrash = cleanTrashRegistrations(extracted.trash);
  const importedDraft = cleanFormDraft(extracted.formDraft);
  const importedJsonSnapshots = cleanJsonSnapshots(extracted.jsonSnapshots);
  const importedCustomers = cleanCustomers([
    ...extracted.customers,
    ...deriveCustomersFromRegistrations(importedRegistrations)
  ]);

  if (overwrite) {
    registrations = importedRegistrations;
    trashRegistrations = importedTrash;
    formDraft = importedDraft;
    jsonSnapshots = importedJsonSnapshots;
    customers = importedCustomers;
  } else {
    registrations = cleanRegistrations([...registrations, ...importedRegistrations]);
    trashRegistrations = cleanTrashRegistrations([...trashRegistrations, ...importedTrash]);
    formDraft = hasDraftContent(formDraft) ? formDraft : importedDraft;
    jsonSnapshots = cleanJsonSnapshots([...jsonSnapshots, ...importedJsonSnapshots]);
    customers = cleanCustomers([...customers, ...importedCustomers, ...deriveCustomersFromRegistrations(registrations)]);
  }

  selectedLocation = "";
  activeLocation = registrations[0]?.storageLocation || "";
  createJsonSnapshot("Backup geimporteerd");
  await persistAll();
  prepareBackupDownload();
  renderAll();
  showToast("Backup geimporteerd", "Dashboard, locatie-overzicht, tabel en prullenbak zijn bijgewerkt.", "success");
}

function extractBackupData(parsed) {
  if (Array.isArray(parsed)) {
    return {
      registrations: parsed,
      customers: [],
      trash: [],
      formDraft: {},
      jsonSnapshots: []
    };
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.registrations)) {
    return null;
  }

  return {
    registrations: parsed.registrations,
    customers: Array.isArray(parsed.customers) ? parsed.customers : [],
    trash: Array.isArray(parsed.trash) ? parsed.trash : [],
    formDraft: parsed.formDraft && typeof parsed.formDraft === "object" ? parsed.formDraft : {},
    jsonSnapshots: Array.isArray(parsed.jsonSnapshots) ? parsed.jsonSnapshots : []
  };
}

function showToast(title, message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(message)}</p>
  `;

  elements.toastContainer.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3600);
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
