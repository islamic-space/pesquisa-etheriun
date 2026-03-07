/**
 * @file app.js
 * @description Interface web para o contrato IslamicPassport.
 *              Usa ethers.js v6 + web3Client.js para conectar ao MetaMask e interagir com o contrato.
 *              Dados pessoais são mantidos localmente; apenas hashes vão on-chain.
 *              Todas as transações passam por modal de confirmação com estimativa de gas.
 */

// ═══════════════════════════════════════════════════════════
//  ABI mínima do contrato IslamicPassport
// ═══════════════════════════════════════════════════════════

const CONTRACT_ABI = [
  // ── Escrita ──
  "function registerProfile(bytes32 hNomeOficial, bytes32 hNomeMuculmano, bytes32 hMesquita, string optionalUri) external",
  "function attestMuslim(address subject, bytes32 claimHash, string optionalUri) external",
  "function promoteToSheikh(address subject, bytes32 claimHash, string optionalUri) external",
  "function revokeCredential(uint256 credentialId) external",

  // ── Leitura ──
  "function getDID(address user) view returns (string)",
  "function getProfile(address user) view returns (uint256 userId, bytes32 hNomeOficial, bytes32 hNomeMuculmano, bytes32 hMesquita, string uri, bool exists)",
  "function getCredentialsOf(address user) view returns (uint256[])",
  "function getCredential(uint256 id) view returns (uint256 credId, uint8 credType, address issuer, address subject, bytes32 claimHash, string uri, uint256 issuedAt, bool revoked)",
  "function listSheikhs() view returns (address[])",
  "function isSheikh(address) view returns (bool)",
  "function totalCredentials() view returns (uint256)",
  "function totalUsers() view returns (uint256)",
  "function deployChainId() view returns (uint256)",
  "function identifyContract() view returns (string)",
  "function getAvailableAttestationTypes() view returns ((uint8 id, string key, string label, string description)[])",

  // ── Eventos ──
  "event ProfileRegistered(address indexed user, uint256 indexed userId, bytes32 hNomeOficial, bytes32 hNomeMuculmano, bytes32 hMesquita, string uri)",
  "event CredentialIssued(uint256 indexed credentialId, uint8 credType, address indexed issuer, address indexed subject, bytes32 claimHash, string uri)",
  "event AttestedMuslim(address indexed issuer, address indexed subject, uint256 indexed credentialId)",
  "event SheikhPromoted(address indexed issuer, address indexed subject, uint256 indexed credentialId)",
  "event CredentialRevoked(uint256 indexed credentialId, address indexed revokedBy)"
];

// ═══════════════════════════════════════════════════════════
//  Estado global
// ═══════════════════════════════════════════════════════════

/** @type {ethers.Contract|null} */
let contract = null;

/** @type {string|null} Endereço conectado */
let currentAccount = null;

/** @type {string|null} ChainId atual */
let currentChainId = null;

/** @type {string|null} Endereço do contrato ativo */
let contractAddress = null;

/** @type {string[]} Lista de endereços de contratos registrados */
let contractList = [];

/** @type {object|null} Metadados do contrato ativo */
let contractMetadata = null;

const MAX_AUTO_SCAN_BLOCKS = 10000;
const contractScanModalState = {
  isOpen: false,
  running: false,
  foundAddress: null,
  foundBlock: null,
  reason: ""
};

/** @type {boolean} Indica se o usuário atual já está registrado on-chain */
let isRegistered = false;

/** @type {boolean} Indica se o usuário atual é sheik */
let isSheik = false;

/** @type {boolean} Indica se o usuário atual é o SuperAdmin da V2 (userId 1) */
let isSuperAdmin = false;

/** @type {boolean} Permissão efetiva para atestar muçulmano */
let canAttestMuslim = false;

/** @type {boolean} Permissão efetiva para promover sheik */
let canPromoteToSheik = false;

/**
 * Nomes dos tipos de credencial (espelhando o enum do contrato).
 */
const CRED_TYPE_NAMES = ["INITIAL", "MUSLIM_ATTESTATION", "SHEIK_CERTIFICATE"];
const CRED_BADGE_CLASS = ["badge-initial", "badge-muslim", "badge-sheik"];

/**
 * Seletores de botões on-chain que devem ser desabilitados quando desconectado.
 */
const ONCHAIN_BUTTONS_SELECTOR = [
  '#formRegister button[type="submit"]',
  '#formIssue button[type="submit"]',
  '#formRevoke button[type="submit"]',
  '#btnExportVC',
  '#btnRefreshSheikhs'
].join(",");

/**
 * Catálogo dinâmico de tipos de credencial retornados pelo contrato.
 * Estrutura por chave (ex.: MUSLIM_ATTESTATION).
 */
const attestationTypeCatalog = new Map();

/** Marca quais recursos opcionais o contrato suporta. */
const contractCapabilities = {
  identifyContract: true,
  attestationCatalog: true
};

/** Ordem padrão caso chamada ao contrato falhe. */
const FALLBACK_ATTESTATION_TYPES = [
  {
    key: "INITIAL",
    label: "Registro Inicial",
    description: "Credencial automática emitida ao registrar o perfil no Islamic Passport.",
    contractMethod: "registerProfile",
    vcType: "InitialCredential",
    successMessage: "Registro inicial confirmado!",
    buildClaims: () => ({ issuedBy: contractAddress || "0x" })
  },
  {
    key: "MUSLIM_ATTESTATION",
    label: "Atestado de Muçulmano",
    description: "Certifica que o sujeito possui fé muçulmana reconhecida por um sheik.",
    contractMethod: "attestMuslim",
    vcType: "MuslimAttestation",
    successMessage: "Atestado de muçulmano emitido com sucesso!",
    buildClaims: () => ({ attestedBy: currentAccount })
  },
  {
    key: "SHEIK_CERTIFICATE",
    label: "Certificado de Sheik",
    description: "Concede autoridade para emitir atestos e promover novos sheiks.",
    contractMethod: "promoteToSheikh",
    vcType: "SheikhCertificate",
    successMessage: "Promoção a sheik realizada com sucesso!",
    buildClaims: () => ({ promotedBy: currentAccount, certificateType: "SHEIK_CERTIFICATE" })
  }
];

// ═══════════════════════════════════════════════════════════
//  Modal automático de varredura de contratos
// ═══════════════════════════════════════════════════════════

function maybePromptContractScan(reason = "Nenhum contrato informado nesta rede. Vamos buscar automaticamente?") {
  if (!Web3Client.isMetaMaskAvailable()) return;
  if (contractScanModalState.isOpen || contractScanModalState.running) return;
  if (contractAddress) return;
  if (contractList.length > 0) return;
  if (!currentAccount) return;
  showContractScanModal(reason);
  runContractScanModal();
}

function showContractScanModal(reason) {
  const modal = document.getElementById("contractScanModal");
  if (!modal) return;
  contractScanModalState.isOpen = true;
  contractScanModalState.running = false;
  contractScanModalState.foundAddress = null;
  contractScanModalState.foundBlock = null;
  contractScanModalState.reason = reason;

  const reasonEl = document.getElementById("contractScanReason");
  if (reasonEl) reasonEl.textContent = reason;

  updateContractScanStatus(`Preparando varredura (até ${MAX_AUTO_SCAN_BLOCKS.toLocaleString("pt-BR")} blocos)…`);

  const logEl = document.getElementById("contractScanLog");
  if (logEl) logEl.innerHTML = "";

  const resultEl = document.getElementById("contractScanResult");
  if (resultEl) resultEl.classList.add("hidden");

  const manualInput = document.getElementById("contractScanManualInput");
  if (manualInput) manualInput.value = "";

  updateContractScanAcceptState();
  modal.classList.remove("hidden");
}

function hideContractScanModal() {
  const modal = document.getElementById("contractScanModal");
  if (!modal) return;
  modal.classList.add("hidden");
  contractScanModalState.isOpen = false;
}

function updateContractScanStatus(text) {
  const statusEl = document.getElementById("contractScanStatus");
  if (!statusEl) return;
  statusEl.textContent = text;
}

function appendContractScanLog(text) {
  const logEl = document.getElementById("contractScanLog");
  if (!logEl) return;
  const row = document.createElement("div");
  row.textContent = text;
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
}

function setContractScanResult(address, blockNumber) {
  const resultEl = document.getElementById("contractScanResult");
  const addrEl = document.getElementById("contractScanAddress");
  const blockEl = document.getElementById("contractScanBlock");
  if (!resultEl || !addrEl || !blockEl) return;
  if (!address) {
    resultEl.classList.add("hidden");
    return;
  }
  addrEl.textContent = address;
  blockEl.textContent = blockNumber != null ? blockNumber.toString() : "manual";
  resultEl.classList.remove("hidden");
}

function getManualOverrideAddress() {
  const manualInput = document.getElementById("contractScanManualInput");
  if (!manualInput) return null;
  const candidate = manualInput.value.trim();
  if (!candidate) return null;
  try {
    return ethers.getAddress(candidate);
  } catch (_) {
    return null;
  }
}

function updateContractScanAcceptState() {
  const btn = document.getElementById("contractScanAccept");
  if (!btn) return;
  const manualAddr = getManualOverrideAddress();
  btn.disabled = !manualAddr && !contractScanModalState.foundAddress;
}

function handleContractScanManualInput() {
  if (!contractScanModalState.isOpen) return;
  const manualAddr = getManualOverrideAddress();
  if (manualAddr) {
    setContractScanResult(manualAddr, null);
    updateContractScanStatus(`Endereço manual detectado: ${shortAddr(manualAddr)}.`);
  } else if (!contractScanModalState.foundAddress) {
    setContractScanResult(null, null);
    if (!contractScanModalState.running) {
      updateContractScanStatus(`Informe um endereço ou aguarde a varredura automática.`);
    }
  } else {
    setContractScanResult(contractScanModalState.foundAddress, contractScanModalState.foundBlock);
  }
  updateContractScanAcceptState();
}

async function handleContractScanAccept() {
  const manualAddr = getManualOverrideAddress();
  const targetAddr = manualAddr || contractScanModalState.foundAddress;
  if (!targetAddr) return;
  hideContractScanModal();
  await addContractAddress(targetAddr);
}

async function runContractScanModal() {
  if (!contractScanModalState.isOpen) return;
  if (contractScanModalState.running) return;
  if (!Web3Client.isMetaMaskAvailable()) {
    updateContractScanStatus("MetaMask não disponível para varredura.");
    return;
  }
  contractScanModalState.running = true;
  contractScanModalState.foundAddress = null;
  contractScanModalState.foundBlock = null;
  setContractScanResult(null, null);
  updateContractScanStatus(`Escaneando últimos ${MAX_AUTO_SCAN_BLOCKS.toLocaleString("pt-BR")} blocos…`);
  appendContractScanLog("Iniciando busca do bloco mais recente.");

  try {
    const result = await scanLatestIslamicPassportContract({
      maxBlocks: MAX_AUTO_SCAN_BLOCKS,
      onProgress: (info) => {
        if (info.type === "block") {
          updateContractScanStatus(`Bloco ${info.blockNumber} · limite ${info.minBlock}`);
          if (
            info.blockNumber === info.latestBlock ||
            info.blockNumber === info.minBlock ||
            info.blockNumber % 200 === 0
          ) {
            appendContractScanLog(`Bloco ${info.blockNumber} verificado.`);
          }
        } else if (info.type === "candidate") {
          appendContractScanLog(`Verificando contrato ${shortAddr(info.address)} no bloco ${info.blockNumber}…`);
        }
      }
    });

    if (result && result.address) {
      contractScanModalState.foundAddress = result.address;
      contractScanModalState.foundBlock = result.blockNumber;
      setContractScanResult(result.address, result.blockNumber);
      updateContractScanStatus(`Contrato encontrado no bloco ${result.blockNumber}.`);
      appendContractScanLog(`✅ IslamicPassport detectado em ${result.address}.`);
    } else {
      updateContractScanStatus("Nenhum contrato IslamicPassport encontrado no intervalo analisado.");
      appendContractScanLog("⚠️ Nenhum contrato identificado. Informe manualmente ou busque novamente.");
    }
  } catch (err) {
    console.error("[runContractScanModal]", err);
    updateContractScanStatus(`Erro ao buscar contratos: ${err.message || err}`);
    appendContractScanLog("Erro interrompeu a varredura. Tente novamente.");
  } finally {
    contractScanModalState.running = false;
    updateContractScanAcceptState();
  }
}

async function scanLatestIslamicPassportContract({ maxBlocks, onProgress }) {
  if (!window.ethereum) {
    throw new Error("window.ethereum não disponível");
  }
  const latestHex = await window.ethereum.request({ method: "eth_blockNumber" });
  const latestBlock = parseInt(latestHex, 16);
  if (!Number.isFinite(latestBlock)) {
    throw new Error("Não foi possível obter o número do bloco mais recente.");
  }
  const minBlock = Math.max(latestBlock - maxBlocks + 1, 0);

  for (let blockNumber = latestBlock; blockNumber >= minBlock; blockNumber--) {
    onProgress?.({ type: "block", blockNumber, latestBlock, minBlock });
    const block = await window.ethereum.request({
      method: "eth_getBlockByNumber",
      params: ["0x" + blockNumber.toString(16), true]
    });
    if (!block || !block.transactions || block.transactions.length === 0) continue;

    for (const tx of block.transactions) {
      if (tx.to && tx.to !== "0x" && tx.to !== "0x0000000000000000000000000000000000000000") continue;
      const receipt = await window.ethereum.request({
        method: "eth_getTransactionReceipt",
        params: [tx.hash]
      });
      if (!receipt || !receipt.contractAddress) continue;
      const addr = ethers.getAddress(receipt.contractAddress);
      onProgress?.({ type: "candidate", blockNumber, address: addr });
      const isIslamicPassport = await _isIslamicPassportContract(addr);
      if (isIslamicPassport) {
        return { address: addr, blockNumber };
      }
    }
  }

  return { address: null, blockNumber: null };
}

FALLBACK_ATTESTATION_TYPES.forEach((item) => attestationTypeCatalog.set(item.key, item));

let defaultAttestationType = "MUSLIM_ATTESTATION";

/** @type {{address: string, did: string}[]} */
let sheikhDirectory = [];

// ═══════════════════════════════════════════════════════════
//  Metadados do contrato (identifyContract)
// ═══════════════════════════════════════════════════════════

function updateContractMetadataUI() {
  const nameEl = document.getElementById("contractMetaName");
  const versionEl = document.getElementById("contractMetaVersion");
  const pillEl = document.getElementById("contractMetaPill");
  const infoBtn = document.getElementById("contractInfoButton");
  if (!nameEl || !versionEl || !infoBtn) return;

  if (contractMetadata && contractMetadata.address && (!contractAddress || contractMetadata.address.toLowerCase() === contractAddress.toLowerCase())) {
    nameEl.textContent = contractMetadata.name || "IslamicPassport";
    versionEl.textContent = contractMetadata.version ? `v${contractMetadata.version}` : "";
    infoBtn.disabled = false;
    pillEl?.classList.remove("contract-meta-pill--empty");
  } else if (contractAddress) {
    nameEl.textContent = `Contrato ativo: ${shortAddr(contractAddress)}`;
    versionEl.textContent = "carregando metadados…";
    infoBtn.disabled = true;
    pillEl?.classList.add("contract-meta-pill--empty");
  } else {
    nameEl.textContent = "Contrato não configurado";
    versionEl.textContent = "—";
    infoBtn.disabled = true;
    pillEl?.classList.add("contract-meta-pill--empty");
  }
}

function resetContractMetadata() {
  contractMetadata = null;
  updateContractMetadataUI();
}

function resetContractCapabilities() {
  contractCapabilities.identifyContract = true;
  contractCapabilities.attestationCatalog = true;
}

function applyLegacyContractMetadataFallback(message) {
  if (message) {
    console.warn(message);
  }
  contractMetadata = {
    name: "IslamicPassport (Legacy)",
    version: "",
    deployDate: "—",
    deployTimestamp: null,
    deployChainId: currentChainId || "—",
    authors: [],
    address: contractAddress,
    isLegacy: true
  };
  updateContractMetadataUI();
}

function isMissingFunctionError(err) {
  if (!err) return false;
  const noData = !err.data || err.data === "0x";
  if (err.code === "CALL_EXCEPTION" && noData) return true;
  if ((err.code === 3 || err.code === -32603) && noData) return true;
  const msg = typeof err.message === "string" ? err.message.toLowerCase() : "";
  return msg.includes("execution reverted") && noData;
}

function normalizeContractFeatures(features) {
  if (!features) return {};
  if (typeof features === "string") {
    try { return JSON.parse(features); } catch (_) { return {}; }
  }
  if (typeof features === "object") return features;
  return {};
}

function normalizeContractAuthors(authors) {
  if (!authors) return [];
  if (Array.isArray(authors)) return authors;
  if (typeof authors === "string") {
    try {
      const parsed = JSON.parse(authors);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

async function refreshContractMetadata() {
  if (!contractAddress) {
    resetContractMetadata();
    return;
  }

  if (!contractCapabilities.identifyContract) {
    applyLegacyContractMetadataFallback();
    return;
  }

  try {
    const rc = Web3Client.getReadContract(CONTRACT_ABI, contractAddress);
    const raw = await rc.identifyContract();
    const parsed = _parseIdentifyContractPayload(raw);
    if (!parsed) {
      resetContractMetadata();
      return;
    }
    contractMetadata = {
      ...parsed,
      features: normalizeContractFeatures(parsed.features),
      authors: normalizeContractAuthors(parsed.authors),
      address: contractAddress
    };
  } catch (err) {
    if (isMissingFunctionError(err)) {
      contractCapabilities.identifyContract = false;
      applyLegacyContractMetadataFallback("[refreshContractMetadata] identifyContract indisponível neste contrato (modo legacy).");
      return;
    }
    console.warn("[refreshContractMetadata] identifyContract falhou:", err.message);
    resetContractMetadata();
    return;
  }

  updateContractMetadataUI();
}

function openContractInfoModal() {
  if (!contractMetadata) return;
  renderContractInfoModal(contractMetadata);
  const modal = document.getElementById("contractInfoModal");
  modal?.classList.remove("hidden");
}

function closeContractInfoModal() {
  const modal = document.getElementById("contractInfoModal");
  modal?.classList.add("hidden");
}

function renderContractInfoModal(meta) {
  if (!meta) return;
  const addressFull = meta.address || contractAddress;
  const addressEl = document.getElementById("contractInfoAddress");
  const inlineAddrEl = document.getElementById("contractInfoAddressInline");
  const nameEl = document.getElementById("contractInfoName");
  const versionEl = document.getElementById("contractInfoVersion");
  const dateEl = document.getElementById("contractInfoDate");
  const timestampEl = document.getElementById("contractInfoTimestamp");
  const chainEl = document.getElementById("contractInfoChain");

  if (addressEl) {
    addressEl.textContent = addressFull ? `Contrato ativo: ${addressFull}` : "Nenhum contrato ativo.";
  }
  if (inlineAddrEl) {
    inlineAddrEl.textContent = addressFull || "—";
  }
  if (nameEl) nameEl.textContent = meta.name || "IslamicPassport";
  if (versionEl) versionEl.textContent = meta.version ? `v${meta.version}` : "";
  if (dateEl) dateEl.textContent = meta.deployDate || "—";
  if (timestampEl) timestampEl.textContent = formatDeployTimestamp(meta.deployTimestamp);
  if (chainEl) chainEl.textContent = meta.deployChainId || "—";

  renderContractAuthorsList(document.getElementById("contractInfoAuthors"), meta.authors);
  renderFeatureChips(document.getElementById("contractInfoFeatures"), meta.features);
}

function renderContractAuthorsList(listEl, authors) {
  if (!listEl) return;
  listEl.innerHTML = "";
  const normalized = normalizeContractAuthors(authors);
  if (normalized.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "—";
    listEl.appendChild(empty);
    return;
  }

  normalized.forEach((author) => {
    const li = document.createElement("li");
    const parts = [];
    if (author.name) parts.push(author.name);
    if (author.email) parts.push(author.email);
    if (author.eth) {
      try {
        parts.push(shortAddr(author.eth));
      } catch (_) {
        parts.push(author.eth);
      }
    }
    if (author.sol) parts.push(author.sol);
    li.textContent = parts.length > 0 ? parts.join(" · ") : JSON.stringify(author);
    listEl.appendChild(li);
  });
}

function renderFeatureChips(container, features) {
  if (!container) return;
  container.innerHTML = "";
  const normalized = normalizeContractFeatures(features);
  const entries = Object.entries(normalized);
  if (entries.length === 0) {
    const chip = document.createElement("span");
    chip.className = "feature-chip feature-chip-empty";
    chip.textContent = "Sem dados";
    container.appendChild(chip);
    return;
  }

  entries.forEach(([key, value]) => {
    const chip = document.createElement("span");
    chip.className = `feature-chip ${value ? "feature-chip-on" : "feature-chip-off"}`;
    chip.textContent = value ? `${key} ativo` : `${key} indisponível`;
    container.appendChild(chip);
  });
}

function getAttestationTypeLabel(type) {
  const item = attestationTypeCatalog.get(type);
  return item?.label || type;
}

function getFirstPermittedAttestationType() {
  const types = Array.from(attestationTypeCatalog.keys());
  const preferred = types.find((key) => isTypePermitted(key));
  return preferred || defaultAttestationType;
}

function populateAttestationTypeSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  attestationTypeCatalog.forEach((meta, key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = meta.label;
    selectEl.appendChild(opt);
  });
  if (selectEl.options.length === 0) {
    const opt = document.createElement("option");
    opt.value = defaultAttestationType;
    opt.textContent = getAttestationTypeLabel(defaultAttestationType);
    selectEl.appendChild(opt);
  }
  selectEl.value = defaultAttestationType;
}

function refreshAttestationTypeSelects() {
  const issueSelect = document.getElementById("issueType");
  const requestSelect = document.getElementById("requestType");
  populateAttestationTypeSelect(issueSelect);
  populateAttestationTypeSelect(requestSelect);
}

function refreshIssueTypeAvailability() {
  const select = document.getElementById("issueType");
  if (!select) return;
  let needsFallback = false;
  Array.from(select.options).forEach((option) => {
    const allowed = isTypePermitted(option.value);
    option.disabled = !allowed;
    if (!allowed && select.value === option.value) {
      needsFallback = true;
    }
  });
  if (needsFallback) {
    select.value = getFirstPermittedAttestationType();
  }
  updateIssueRulesHint();
}

function updateIssueRulesHint() {
  const hintEl = document.getElementById("issueRulesHint");
  if (!hintEl) return;
  const select = document.getElementById("issueType");
  const key = select?.value;
  const meta = attestationTypeCatalog.get(key);
  if (!meta) {
    hintEl.textContent = "Selecione o tipo de credencial a ser emitida.";
    return;
  }
  hintEl.textContent = isTypePermitted(key)
    ? (meta.description || "")
    : "Você não possui permissão para emitir este tipo de credencial no momento.";
}

function isTypePermitted(key) {
  if (key === "MUSLIM_ATTESTATION") return canAttestMuslim;
  if (key === "SHEIK_CERTIFICATE") return canPromoteToSheik;
  return true;
}

async function loadAttestationTypesFromContract() {
  if (!contractAddress) return;

  if (!contractCapabilities.attestationCatalog) {
    attestationTypeCatalog.clear();
    FALLBACK_ATTESTATION_TYPES.forEach((item) => attestationTypeCatalog.set(item.key, item));
    defaultAttestationType = FALLBACK_ATTESTATION_TYPES[0].key;
    refreshAttestationTypeSelects();
    refreshIssueTypeAvailability();
    return;
  }

  try {
    const rc = Web3Client.getReadContract(CONTRACT_ABI, contractAddress);

    const types = await rc.getAvailableAttestationTypes();
    attestationTypeCatalog.clear();
    types.forEach((item) => {
      const key = item.key;
      attestationTypeCatalog.set(key, {
        id: Number(item.id),
        key,
        label: item.label,
        description: item.description,
        contractMethod: mapTypeToContractMethod(key),
        vcType: mapTypeToVcType(key),
        buildClaims: mapTypeToClaimBuilder(key)
      });
    });
    if (types.length > 0) {
      defaultAttestationType = types[0].key;
    }
  } catch (err) {
    if (isMissingFunctionError(err)) {
      contractCapabilities.attestationCatalog = false;
      console.warn("[loadAttestationTypesFromContract] Contrato legacy sem catálogo on-chain. Usando fallback local.");
    } else {
      console.warn("[loadAttestationTypesFromContract] Falhou, usando fallback:", err.message);
    }
    attestationTypeCatalog.clear();
    FALLBACK_ATTESTATION_TYPES.forEach((item) => attestationTypeCatalog.set(item.key, item));
    defaultAttestationType = FALLBACK_ATTESTATION_TYPES[0].key;
  }

  refreshAttestationTypeSelects();
  refreshIssueTypeAvailability();
}



function _parseIdentifyContractPayload(rawValue) {
  if (!rawValue || typeof rawValue !== "string") return null;
  try {
    return JSON.parse(rawValue);
  } catch (err) {
    console.warn("[_parseIdentifyContractPayload] JSON inválido:", err.message);
    return null;
  }
}

function mapTypeToContractMethod(key) {
  switch (key) {
    case "MUSLIM_ATTESTATION":
      return "attestMuslim";
    case "SHEIK_CERTIFICATE":
      return "promoteToSheikh";
    default:
      return "attestMuslim";
  }
}

function mapTypeToVcType(key) {
  switch (key) {
    case "SHEIK_CERTIFICATE":
      return "SheikhCertificate";
    case "INITIAL":
      return "IslamicPassportProfile";
    default:
      return "MuslimAttestation";
  }
}

function mapTypeToClaimBuilder(key) {
  switch (key) {
    case "SHEIK_CERTIFICATE":
      return () => ({ promotedBy: currentAccount, certificateType: "SHEIK_CERTIFICATE" });
    case "MUSLIM_ATTESTATION":
      return () => ({ attestedBy: currentAccount });
    default:
      return () => ({ issuedBy: currentAccount, attestationType: key });
  }
}

function updateSheikhDirectoryList() {
  const datalist = document.getElementById("sheikhDirectoryList");
  if (!datalist) return;
  datalist.innerHTML = "";
  sheikhDirectory.forEach((entry) => {
    const opt = document.createElement("option");
    opt.value = entry.did || entry.address;
    opt.textContent = `${entry.did || "(sem DID)"} — ${shortAddr(entry.address)}`;
    datalist.appendChild(opt);
  });
}

function resolveSheikhDirectoryEntry(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const entry = sheikhDirectory.find((item) => {
    return (
      (item.did && item.did.toLowerCase() === lower) ||
      item.address.toLowerCase() === lower
    );
  });
  if (entry) return entry;
  const candidate = extractAddressCandidate(trimmed);
  if (candidate) {
    try {
      const addr = ethers.getAddress(candidate);
      return { address: addr, did: null };
    } catch (_) {
      return null;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

/**
 * Normaliza um texto: trim, colapsa espaços múltiplos, lowercase.
 * @param {string} str
 * @returns {string}
 */
function normalize(str) {
  return str.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Calcula keccak256 de uma string UTF-8.
 * @param {string} value
 * @returns {string} Hash hex 0x...
 */
function hashKeccak(value) {
  return ethers.keccak256(ethers.toUtf8Bytes(value));
}

/**
 * Exibe uma mensagem de status temporária.
 * @param {string} msg
 * @param {"success"|"error"|"warning"|"info"} type
 * @param {number} duration ms
 */
function showStatus(msg, type = "info", duration = 5000) {
  const el = document.getElementById("statusMsg");
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => el.classList.add("hidden"), duration);
}

/**
 * Formata endereço para exibição curta.
 * @param {string} addr
 * @returns {string}
 */
function shortAddr(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

/**
 * Formata timestamp Unix para data legível.
 * @param {bigint|number} ts
 * @returns {string}
 */
function formatTs(ts) {
  const n = Number(ts);
  if (n === 0) return "—";
  return new Date(n * 1000).toLocaleString("pt-BR");
}

function formatDeployTimestamp(value) {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return String(value);
  return new Date(n * 1000).toLocaleString("pt-BR");
}

/**
 * Gera um JSON canônico de VC (Verifiable Credential) simplificado.
 * @param {object} params
 * @returns {object}
 */
function buildVCJson({ type, issuer, subject, claims, issuedAt }) {
  return {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", type],
    issuer: issuer,
    issuanceDate: new Date(Number(issuedAt) * 1000).toISOString(),
    credentialSubject: {
      id: subject,
      ...claims
    }
  };
}

/**
 * Calcula o claimHash (keccak256) de um VC JSON canônico.
 * @param {object} vc
 * @returns {string} bytes32 hex
 */
function vcClaimHash(vc) {
  const canonical = JSON.stringify(vc, Object.keys(vc).sort());
  return ethers.keccak256(ethers.toUtf8Bytes(canonical));
}

/**
 * Salva dados locais do perfil no localStorage.
 * @param {string} address
 * @param {object} data
 */
function saveLocalProfile(address, data) {
  const key = `ip_profile_${address.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Carrega dados locais do perfil do localStorage.
 * @param {string} address
 * @returns {object|null}
 */
function loadLocalProfile(address) {
  const key = `ip_profile_${address.toLowerCase()}`;
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

/**
 * Faz download de um arquivo JSON.
 * @param {object} data
 * @param {string} filename
 */
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Tenta extrair um endereço Ethereum de uma string (direta ou DID).
 * @param {string} value
 * @returns {string|null}
 */
function extractAddressCandidate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ethers.isAddress(trimmed)) return trimmed;
  if (trimmed.startsWith("did:")) {
    const parts = trimmed.split(":");
    const maybeAddr = parts[parts.length - 1];
    if (ethers.isAddress(maybeAddr)) return maybeAddr;
  }
  return null;
}

function normalizeAttestationTypeKey(value) {
  if (!value) return null;
  const str = Array.isArray(value) ? value.join(",") : String(value);
  if (!str) return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  if (attestationTypeCatalog.has(trimmed)) return trimmed;
  const upper = trimmed.toUpperCase();
  if (attestationTypeCatalog.has(upper)) return upper;
  const lowered = trimmed.toLowerCase();
  for (const [key, meta] of attestationTypeCatalog.entries()) {
    if (meta.label?.toLowerCase() === lowered || meta.vcType?.toLowerCase() === lowered) {
      return key;
    }
  }
  return null;
}

function deriveSubjectFromRequest(data) {
  const candidates = [
    data.subject,
    data.subjectAddress,
    data.subjectWallet,
    data.subjectAddr,
    data.subjectAccount,
    data.subjectId,
    data.subjectID,
    data.subjectDid,
    data.subjectDID,
    data.credentialSubject?.id,
    data.credentialSubject?.address,
    data.credentialSubject?.wallet,
    data.credentialSubject?.ethAddress,
    data.credentialSubject?.ethereumAddress
  ];
  for (const candidate of candidates) {
    const addr = extractAddressCandidate(candidate);
    if (addr) return addr;
  }
  return null;
}

function deriveUriFromRequest(data) {
  const candidates = [
    data.uri,
    data.attestUri,
    data.credentialUri,
    data.credentialURI,
    data.offchainUri,
    data.offchainURI,
    data.metadataUri,
    data.metadataURI,
    data.credential?.uri,
    data.credential?.metadataURI,
    data.credentialSubject?.uri
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function deriveAttestationTypeFromRequest(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.attestationType,
    data.requestedType,
    data.requestedCredentialType,
    data.credentialType,
    data.type,
    data.credential?.type,
    data.credential?.types,
    data.claims?.attestationType,
    data.metadata?.attestationType
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const normalized = normalizeAttestationTypeKey(item);
        if (normalized) return normalized;
      }
    } else {
      const normalized = normalizeAttestationTypeKey(candidate);
      if (normalized) return normalized;
    }
  }
  return null;
}

/**
 * Lê o JSON informado na aba de atesto e extrai dados úteis.
 * @param {{silent?: boolean, elementId?: string}} [options]
 * @returns {{data: object, subject?: string, uri?: string, attestationType?: string}|{error: true}|null}
 */
function parseIssueRequestJson({ silent = false, elementId = "issueRequestJSON" } = {}) {
  const textarea = document.getElementById(elementId);
  if (!textarea) return null;
  const raw = textarea.value.trim();
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    return {
      data,
      subject: deriveSubjectFromRequest(data),
      uri: deriveUriFromRequest(data),
      attestationType: deriveAttestationTypeFromRequest(data)
    };
  } catch (err) {
    if (!silent) {
      showStatus("Não foi possível ler o JSON do pedido/certificado. Verifique o conteúdo.", "error");
    }
    console.warn("[parseIssueRequestJson] Falha ao processar JSON:", err.message);
    return { error: true };
  }
}

/**
 * Preenche campos do formulário de atesto com dados derivados do JSON.
 * @param {{subject?: string, uri?: string, attestationType?: string, error?: boolean}|null} parsed
 * @param {{showFeedback?: boolean}} [options]
 */
function autofillIssueFieldsFromRequest(parsed, { showFeedback = false } = {}) {
  if (!parsed || parsed.error) return;
  const subjectInput = document.getElementById("issueSubject");
  const uriInput = document.getElementById("issueUri");
  const typeSelect = document.getElementById("issueType");

  let changed = false;

  if (parsed.subject && subjectInput && !subjectInput.value.trim()) {
    subjectInput.value = parsed.subject;
    changed = true;
  }

  if (parsed.uri && uriInput && !uriInput.value.trim()) {
    uriInput.value = parsed.uri;
    changed = true;
  }

  if (parsed.attestationType && typeSelect && attestationTypeCatalog.has(parsed.attestationType)) {
    if (typeSelect.value !== parsed.attestationType) {
      typeSelect.value = parsed.attestationType;
      changed = true;
    }
  }

  updateIssueRulesHint();

  if (changed && showFeedback) {
    showStatus("Campos preenchidos automaticamente a partir do JSON fornecido.", "info", 3000);
  }
}

/**
 * Handler do upload de arquivo JSON na aba de emissão.
 * @param {Event} event
 */
async function handleIssueJsonFileChange(event) {
  const input = event.target;
  const file = input?.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const textarea = document.getElementById("issueRequestJSON");
    if (textarea) {
      textarea.value = text.trim();
    }
    const parsed = parseIssueRequestJson({ silent: true });
    if (parsed && !parsed.error) {
      autofillIssueFieldsFromRequest(parsed, { showFeedback: false });
      showStatus(`Arquivo ${file.name} carregado.`, "success", 3500);
    } else {
      showStatus("Arquivo carregado, mas o conteúdo não é um JSON válido.", "error");
    }
  } catch (err) {
    showStatus("Não foi possível ler o arquivo JSON.", "error");
    console.warn("[handleIssueJsonFileChange] Erro ao ler arquivo:", err.message);
  } finally {
    if (input) {
      input.value = "";
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  Gerenciamento de estado on-chain (habilitar/desabilitar)
// ═══════════════════════════════════════════════════════════

/**
 * Habilita ou desabilita todos os botões de ações on-chain.
 * @param {boolean} enabled
 */
function setOnchainButtonsEnabled(enabled) {
  document.querySelectorAll(ONCHAIN_BUTTONS_SELECTOR).forEach(btn => {
    btn.disabled = !enabled;
    btn.classList.toggle("btn-disabled", !enabled);
  });
}

// ═══════════════════════════════════════════════════════════
//  Controle de acesso às abas (baseado no estado on-chain)
// ═══════════════════════════════════════════════════════════

/**
 * Consulta o contrato para verificar se o usuário está registrado e se é sheik.
 * Habilita/desabilita as abas conforme:
 *  - Registro: desabilitada se já registrado
 *  - Atestar / Promover: habilitada apenas para sheiks
 */
async function refreshTabAccess() {
  const allTabs = document.querySelectorAll('nav.tabs button');
  const tabRegister = document.querySelector('nav.tabs button[data-tab="tabRegister"]');
  const tabDashboard = document.querySelector('nav.tabs button[data-tab="tabDashboard"]');
  const tabSheikhs = document.querySelector('nav.tabs button[data-tab="tabSheikhs"]');
  const tabAttest   = document.querySelector('nav.tabs button[data-tab="tabAttest"]');
  const tabRequest  = document.querySelector('nav.tabs button[data-tab="tabRequest"]');
  const formAttestButton = document.querySelector('#formAttest button[type="submit"]');
  const formPromoteButton = document.querySelector('#formPromote button[type="submit"]');
  const attestRulesHint = document.getElementById("attestRulesHint");
  const promoteRulesHint = document.getElementById("promoteRulesHint");
  const disconnectedState = document.getElementById("disconnectedState");

  // Estado padrão: tudo habilitado (reset)
  isRegistered = false;
  isSheik = false;
  isSuperAdmin = false;
  canAttestMuslim = false;
  canPromoteToSheik = false;

  if (!currentAccount) {
    if (disconnectedState) disconnectedState.classList.remove("hidden");
    allTabs.forEach((tab) => {
      tab.disabled = true;
      tab.classList.add("tab-disabled");
      tab.title = "Conecte a carteira para acessar";
    });
    if (formAttestButton) formAttestButton.disabled = false;
    if (formPromoteButton) formPromoteButton.disabled = false;
    if (attestRulesHint) attestRulesHint.textContent = "Disponível apenas para sheiks com certificado ativo.";
    if (promoteRulesHint) promoteRulesHint.textContent = "O primeiro sheik pode ser nomeado pelo SuperAdmin. Depois disso, apenas sheiks com certificado ativo podem promover novos sheiks, e o candidato deve possuir atestado de muçulmano.";

    if (!document.querySelector('nav.tabs button.active') || document.querySelector('nav.tabs button.active')?.disabled) {
      allTabs.forEach((tab) => tab.classList.remove("active"));
      document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
      tabRegister.classList.add("active");
      document.getElementById("tabRegister").classList.add("active");
    }
    return;
  }

  if (disconnectedState) disconnectedState.classList.add("hidden");

  allTabs.forEach((tab) => {
    tab.disabled = false;
    tab.classList.remove("tab-disabled");
    tab.title = "";
  });

  if (!contractAddress || !contract) {
    return;
  }

  try {
    const rc = Web3Client.getReadContract(CONTRACT_ABI, contractAddress);
    let currentUserId = 0;

    try {
      const profile = await rc.getProfile(currentAccount);
      isRegistered = !!profile[5];
      currentUserId = Number(profile[0] || 0);
      isSuperAdmin = isRegistered && currentUserId === 1;
    } catch (_) {}

    try {
      isSheik = await rc.isSheikh(currentAccount);
    } catch (_) {}

    canAttestMuslim = isSheik;
    canPromoteToSheik = isSheik || isSuperAdmin;

    console.log(`[refreshTabAccess] isRegistered: ${isRegistered}, isSheik: ${isSheik}, isSuperAdmin: ${isSuperAdmin}, canPromoteToSheik: ${canPromoteToSheik}`);

    if (isRegistered) {
      tabRegister.disabled = true;
      tabRegister.classList.add("tab-disabled");
      tabRegister.title = "Você já possui cadastro on-chain";
      if (tabRegister.classList.contains("active")) {
        switchTab("tabDashboard");
      }
    } else {
      tabRegister.disabled = false;
      tabRegister.classList.remove("tab-disabled");
      tabRegister.title = "";
    }

    if (!canAttestMuslim && !canPromoteToSheik) {
      tabAttest.disabled = true;
      tabAttest.classList.add("tab-disabled");
      tabAttest.title = "Disponível apenas para sheiks ativos ou SuperAdmin da V2";
      if (tabAttest.classList.contains("active")) {
        switchTab("tabDashboard");
      }
    } else {
      tabAttest.disabled = false;
      tabAttest.classList.remove("tab-disabled");
      tabAttest.title = "";
    }

    if (formAttestButton) {
      formAttestButton.disabled = !canAttestMuslim;
      formAttestButton.classList.toggle("btn-disabled", !canAttestMuslim);
    }
    if (formPromoteButton) {
      formPromoteButton.disabled = !canPromoteToSheik;
      formPromoteButton.classList.toggle("btn-disabled", !canPromoteToSheik);
    }
    if (attestRulesHint) {
      attestRulesHint.textContent = canAttestMuslim
        ? "Você pode emitir atestado de muçulmano nesta carteira."
        : "Disponível apenas para sheiks com certificado ativo.";
    }
    if (promoteRulesHint) {
      if (isSuperAdmin && !isSheik) {
        promoteRulesHint.textContent = "Como SuperAdmin, você pode nomear o primeiro sheik. O contrato emitirá o atestado de muçulmano do candidato se ele ainda não existir.";
      } else if (canPromoteToSheik) {
        promoteRulesHint.textContent = "Você pode promover novos sheiks. O candidato precisa possuir atestado de muçulmano ativo.";
      } else {
        promoteRulesHint.textContent = "O primeiro sheik pode ser nomeado pelo SuperAdmin. Depois disso, apenas sheiks com certificado ativo podem promover novos sheiks, e o candidato deve possuir atestado de muçulmano.";
      }
    }

    tabDashboard.disabled = false;
    tabDashboard.classList.remove("tab-disabled");
    tabSheikhs.disabled = false;
    tabSheikhs.classList.remove("tab-disabled");
    tabRequest.disabled = false;
    tabRequest.classList.remove("tab-disabled");

  } catch (err) {
    console.warn("[refreshTabAccess] Erro ao verificar status:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  Atualizar saldo na UI
// ═══════════════════════════════════════════════════════════

/**
 * Busca e exibe o saldo da conta conectada em todos os pontos da UI.
 */
async function refreshBalance() {
  if (!currentAccount) return;
  try {
    const bal = await Web3Client.getBalanceETH(currentAccount);
    const formatted = parseFloat(bal).toFixed(4);
    document.getElementById("walletBalance").textContent = formatted;
    document.getElementById("walletPanelBalanceValue").textContent = formatted;
    document.getElementById("walletPanelBalance").classList.remove("hidden");
  } catch (err) { console.error("[refreshBalance] Erro:", err); }
}

// ═══════════════════════════════════════════════════════════
//  Conexão com MetaMask (via Web3Client)
// ═══════════════════════════════════════════════════════════

/**
 * Conecta ao MetaMask usando Web3Client, atualiza toda a UI.
 */
/**
 * Mapa de chainId para nome amigável de redes conhecidas.
 */
const KNOWN_NETWORKS = {
  "1":     "Ethereum Mainnet",
  "5":     "Goerli Testnet",
  "11155111": "Sepolia Testnet",
  "17000":  "Holesky Testnet",
  "10":    "Optimism",
  "42161": "Arbitrum One",
  "137":   "Polygon Mainnet",
  "80001": "Polygon Mumbai",
  "80002": "Polygon Amoy",
  "56":    "BNB Smart Chain",
  "43114": "Avalanche C-Chain",
  "250":   "Fantom Opera",
  "100":   "Gnosis Chain",
  "1337":  "Localhost 1337",
  "5777":  "Localhost 5777",
  "31337": "Hardhat (31337)"
};

/**
 * Retorna o nome amigável da rede a partir do chainId.
 * Tenta o mapa local e, se não encontrar, consulta o MetaMask.
 * @param {string} chainId
 * @returns {Promise<string>}
 */
async function getNetworkFriendlyName(chainId) {
  if (KNOWN_NETWORKS[chainId]) return KNOWN_NETWORKS[chainId];

  // Fallback: tenta obter o nome via ethers provider
  try {
    const provider = Web3Client.getProviderFromMetaMask();
    const network = await provider.getNetwork();
    if (network.name && network.name !== "unknown") {
      return network.name + " (Chain " + chainId + ")";
    }
  } catch (_) {}

  return "Rede Personalizada (Chain " + chainId + ")";
}

/**
 * Desconecta a carteira (reseta estado da app, não do MetaMask).
 */
function disconnectWallet() {
  // Reseta estado
  currentAccount = null;
  currentChainId = null;
  contract = null;
  contractAddress = null;
  Web3Client.reset();
  resetContractMetadata();

  // Reseta header
  document.getElementById("walletInfo").classList.add("hidden");
  document.getElementById("btnConnect").textContent = "Conectar MetaMask";
  document.getElementById("btnDisconnect").classList.add("hidden");

  // Reseta painel
  document.getElementById("walletPanel").classList.add("hidden");
  document.getElementById("walletStatusLabel").textContent = "Desconectado";
  document.getElementById("walletStatusLabel").classList.remove("wallet-connected");
  document.getElementById("walletPanelBalance").classList.add("hidden");

  // Desabilita botões on-chain
  setOnchainButtonsEnabled(false);

  // Reseta abas (habilita todas novamente)
  refreshTabAccess();

  showStatus("Carteira desconectada.", "info", 3000);
}

let _connecting = false;

async function connectWallet() {
  if (_connecting) {
    showStatus("Aguarde… já existe uma solicitação de conexão pendente no MetaMask.", "warning", 4000);
    return;
  }
  if (!Web3Client.isMetaMaskAvailable()) {
    showStatus("MetaMask não encontrado. Instale a extensão para continuar.", "error");
    return;
  }

  _connecting = true;
  document.getElementById("btnConnect").disabled = true;

  try {
    const { address, chainId } = await Web3Client.connectWallet();
    currentAccount = address;
    currentChainId = chainId;

    // Atualiza header
    document.getElementById("walletAddress").textContent = shortAddr(currentAccount);
    document.getElementById("walletChain").textContent = currentChainId;
    document.getElementById("walletInfo").classList.remove("hidden");
    document.getElementById("btnConnect").textContent = shortAddr(currentAccount);
    document.getElementById("btnDisconnect").classList.remove("hidden");

    // Atualiza painel de carteira
    document.getElementById("walletPanel").classList.remove("hidden");
    document.getElementById("walletStatusLabel").textContent = "Conectado: " + shortAddr(currentAccount);
    document.getElementById("walletStatusLabel").classList.add("wallet-connected");

    // Popula select de rede com nome amigável
    const selNet = document.getElementById("selectNetwork");
    const netFriendlyName = await getNetworkFriendlyName(chainId);
    selNet.innerHTML = `<option value="${chainId}">${netFriendlyName} (Chain ${chainId})</option>`;

    // Popula select de contas (todas as contas autorizadas no MetaMask)
    await refreshAccountsList();

    // Atualiza saldo
    await refreshBalance();

    // Habilita botões on-chain após conexão
    console.log("[connectWallet] chainId:", chainId, "network:", netFriendlyName);
    setOnchainButtonsEnabled(true);

    showStatus(`Conectado: ${shortAddr(currentAccount)} (chain ${currentChainId})`, "success");

    // Se já tem contrato selecionado, reconecta
    if (contractAddress) {
      await attachContract(contractAddress);
    }

    // Tenta restaurar contratos salvos
    loadContractList();

    // Fallback: se contract ainda é null, tenta o valor atual do combobox
    if (!contract) {
      const selVal = document.getElementById("selectContract").value;
      if (selVal) await attachContract(selVal);
    }

    if (!contractAddress && contractList.length === 0) {
      maybePromptContractScan("Nenhum contrato configurado. Vamos buscar automaticamente?");
    }

    await refreshTabAccess();

  } catch (err) {
    console.error("[connectWallet] Erro:", err);
    if (err.code === -32002) {
      showStatus("Já existe uma solicitação pendente no MetaMask. Abra a extensão e aprove ou rejeite antes de tentar novamente.", "warning", 8000);
    } else {
      const msg = Web3Client.parseError(err);
      showStatus("Erro ao conectar: " + msg, "error");
    }
  } finally {
    _connecting = false;
    const btn = document.getElementById("btnConnect");
    btn.disabled = false;
    if (!currentAccount) btn.textContent = "Conectar MetaMask";
  }
}

/**
 * Busca as contas autorizadas no MetaMask e popula o select.
 */
async function refreshAccountsList() {
  try {
    const provider = Web3Client.getProviderFromMetaMask();
    const accounts = await provider.send("eth_accounts", []);
    const sel = document.getElementById("selectAccount");
    sel.innerHTML = "";

    for (const acc of accounts) {
      let bal = "?";
      try {
        const b = await provider.getBalance(acc);
        bal = parseFloat(ethers.formatEther(b)).toFixed(4);
      } catch (_) {}

      // Tenta resolver nome ENS (reverse lookup) para exibir nome amigável
      let ensName = null;
      try {
        ensName = await provider.lookupAddress(acc);
      } catch (_) {}

      const opt = document.createElement("option");
      opt.value = acc;
      if (ensName) {
        opt.textContent = `${ensName} (${shortAddr(acc)}) — ${bal} ETH`;
      } else {
        opt.textContent = `${shortAddr(acc)} — ${bal} ETH`;
      }
      if (acc.toLowerCase() === currentAccount.toLowerCase()) opt.selected = true;
      sel.appendChild(opt);
    }
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
//  Contrato: lista de endereços (combobox descrescente)
// ═══════════════════════════════════════════════════════════

/**
 * Carrega a lista de contratos salvos do localStorage.
 */
function loadContractList() {
  try {
    const raw = localStorage.getItem("ip_contractList");
    contractList = raw ? JSON.parse(raw) : [];
  } catch (_) { contractList = []; }

  // Garante que o último endereço salvo antigo esteja na lista (normalizado)
  const legacy = localStorage.getItem("ip_contractAddress");
  if (legacy) {
    let legacyNorm;
    try { legacyNorm = ethers.getAddress(legacy); } catch (_) { legacyNorm = legacy; }
    const alreadyIn = contractList.some(a => {
      try { return ethers.getAddress(a) === legacyNorm; } catch (_) { return a === legacy; }
    });
    if (!alreadyIn) contractList.push(legacyNorm);
  }

  renderContractSelect();

  // Auto-seleciona o mais recente (primeiro da lista)
  if (contractList.length > 0 && !contractAddress) {
    const newest = contractList[0];
    // attachContract é async; aqui é fire-and-forget (loadContractList é sync)
    attachContract(newest).then(() => {
      document.getElementById("selectContract").value = newest;
    });
  }
}

/**
 * Salva a lista de contratos no localStorage.
 */
function saveContractList() {
  localStorage.setItem("ip_contractList", JSON.stringify(contractList));
}

/**
 * Renderiza o select de contratos (ordem da lista: mais recente primeiro).
 */
function renderContractSelect() {
  const sel = document.getElementById("selectContract");
  sel.innerHTML = "";

  if (contractList.length === 0) {
    sel.innerHTML = '<option value="">— adicione endereços de contrato —</option>';
    return;
  }

  for (const addr of contractList) {
    const opt = document.createElement("option");
    opt.value = addr;
    opt.textContent = addr;
    if (addr === contractAddress) opt.selected = true;
    sel.appendChild(opt);
  }
}

/**
 * Remove o contrato selecionado do combobox e da lista.
 */
function removeSelectedContract() {
  const sel = document.getElementById("selectContract");
  const addr = sel.value;
  if (!addr) {
    showStatus("Nenhum contrato selecionado para remover.", "warning");
    return;
  }

  // Normaliza para checksum antes de comparar
  let normalized;
  try { normalized = ethers.getAddress(addr); } catch (_) { normalized = addr; }

  const before = contractList.length;
  contractList = contractList.filter(a => {
    try { return ethers.getAddress(a) !== normalized; } catch (_) { return a !== addr; }
  });
  saveContractList();

  // Se o contrato removido era o ativo, limpa
  if (contractAddress && contractAddress.toLowerCase() === addr.toLowerCase()) {
    contractAddress = null;
    contract = null;
    localStorage.removeItem("ip_contractAddress");
    resetContractMetadata();
  }

  renderContractSelect();

  // Auto-seleciona o próximo contrato disponível
  if (contractList.length > 0 && currentAccount) {
    const next = contractList[0];
    sel.value = next;
    attachContract(next);
  }

  showStatus(`Contrato ${shortAddr(addr)} removido da lista. (${before - contractList.length} removido(s))`, "info", 4000);

  if (contractList.length === 0 && currentAccount) {
    maybePromptContractScan("Nenhum contrato restante. Buscar automaticamente na blockchain?");
  }
}

/**
 * Adiciona um endereço de contrato à lista e seleciona-o.
 * @param {string} addr
 */
async function addContractAddress(addr) {
  if (!ethers.isAddress(addr)) {
    showStatus("Endereço de contrato inválido.", "error");
    return;
  }
  addr = ethers.getAddress(addr); // checksum
  // Evita duplicatas
  if (!contractList.includes(addr)) {
    contractList.unshift(addr); // mais recente no topo
    saveContractList();
  }
  renderContractSelect();
  await attachContract(addr);
  document.getElementById("selectContract").value = addr;
  document.getElementById("inputContractAddr").value = "";
}

/**
 * Verifica se o contrato no endereço dado é um IslamicPassport.
 * Tenta chamar deployChainId() e totalUsers() — se ambos
 * responderem sem erro, é muito provável que seja o nosso contrato.
 * @param {string} addr
 * @returns {Promise<boolean>}
 */
async function _isIslamicPassportContract(addr) {
  try {
    const tempContract = Web3Client.getReadContract(CONTRACT_ABI, addr);
    // deployChainId é uma variável pública única do IslamicPassport
    await tempContract.deployChainId();
    // totalUsers retorna uint256 sem revert — verifica compatibilidade da ABI
    await tempContract.totalUsers();
    return true;
  } catch (e) {
    console.log(`[_isIslamicPassportContract] ${addr} falhou:`, e.code || e.message);
    return false;
  }
}

/**
 * Escaneia blocos da blockchain procurando transações de criação de contrato.
 * Busca do bloco mais recente ao mais antigo, em lotes configuráveis.
 * Apenas contratos IslamicPassport são adicionados à lista.
 * @param {number} maxContracts - Máximo de contratos a encontrar
 * @param {number} blockBatch - Quantidade de blocos por lote
 */
async function scanBlockchainForContracts() {
  if (!Web3Client.isMetaMaskAvailable()) {
    showStatus("MetaMask não disponível.", "error");
    return;
  }

  const maxContracts = parseInt(document.getElementById("inputScanContracts").value) || 5;
  const blockBatch   = parseInt(document.getElementById("inputScanBlocks").value) || 1000;
  const progressEl   = document.getElementById("scanProgress");
  const btnScan      = document.getElementById("btnScanContracts");

  // Desabilita botão durante scan
  btnScan.disabled = true;
  btnScan.textContent = "⏳ Buscando…";
  progressEl.classList.remove("hidden");
  progressEl.textContent = "Iniciando…";

  let blocksScanned = 0;
  const foundAddrs = [];

  try {
    // Obtém o número do bloco mais recente
    const latestHex = await window.ethereum.request({ method: "eth_blockNumber" });
    const latestBlock = parseInt(latestHex, 16);

    if (latestBlock === 0) {
      showStatus("Nenhum bloco encontrado na rede.", "warning");
      progressEl.textContent = "Nenhum bloco na rede.";
    } else {

      // Calcula o bloco mínimo: não escanear mais do que blockBatch blocos no total
      const minBlock = Math.max(latestBlock - blockBatch + 1, 0);
      let hi = latestBlock;

      while (hi >= minBlock && foundAddrs.length < maxContracts) {
        const lo = Math.max(hi - 49, minBlock); // lotes de 50 blocos para feedback
        progressEl.textContent = `Blocos ${lo}–${hi} (${blocksScanned} escaneados, ${foundAddrs.length}/${maxContracts} contratos)`;

        for (let i = hi; i >= lo; i--) {
          if (foundAddrs.length >= maxContracts) break;

          const block = await window.ethereum.request({
            method: "eth_getBlockByNumber",
            params: ["0x" + i.toString(16), true]
          });

          blocksScanned++;

          if (!block || !block.transactions) continue;

          for (const tx of block.transactions) {
            if (foundAddrs.length >= maxContracts) break;

            // Transação de deploy: `to` é null
            if (tx.to === null || tx.to === "0x" || tx.to === "0x0000000000000000000000000000000000000000") {
              const receipt = await window.ethereum.request({
                method: "eth_getTransactionReceipt",
                params: [tx.hash]
              });

              if (receipt && receipt.contractAddress) {
                const addr = ethers.getAddress(receipt.contractAddress);
                // Pula apenas se já encontrado NESTE scan
                if (!foundAddrs.includes(addr)) {
                  progressEl.textContent = `Verificando contrato ${shortAddr(addr)}…`;
                  const isIP = await _isIslamicPassportContract(addr);
                  if (isIP) {
                    foundAddrs.push(addr);
                    const alreadyInList = contractList.some(a => {
                      try { return ethers.getAddress(a) === addr; } catch (_) { return false; }
                    });
                    console.log(`[scan] ✅ IslamicPassport bloco ${i}: ${addr}${alreadyInList ? " (já na lista)" : " (novo)"}`);
                    progressEl.textContent = `✅ IslamicPassport: ${shortAddr(addr)} (${foundAddrs.length}/${maxContracts})`;
                  } else {
                    console.log(`[scan] ❌ Bloco ${i}: ${addr} não é IslamicPassport`);
                  }
                }
              }
            }
          }
        }

        hi = lo - 1;
      }
    }

    // Filtra apenas os novos (que ainda não estão na lista)
    const newAddrs = foundAddrs.filter(addr => !contractList.some(a => {
      try { return ethers.getAddress(a) === addr; } catch (_) { return false; }
    }));

    // Insere novos na lista (newest-first)
    if (newAddrs.length > 0) {
      for (let i = newAddrs.length - 1; i >= 0; i--) {
        contractList.unshift(newAddrs[i]);
      }
      saveContractList();
    }

    if (foundAddrs.length > 0) {
      renderContractSelect();
      const newest = contractList[0];
      document.getElementById("selectContract").value = newest;
      if (currentAccount) await attachContract(newest);
      const detail = newAddrs.length > 0
        ? ` (${newAddrs.length} novo(s), ${foundAddrs.length - newAddrs.length} já na lista)`
        : " (todos já estavam na lista)";
      showStatus(`✅ ${foundAddrs.length} contrato(s) IslamicPassport encontrado(s) em ${blocksScanned} blocos!${detail}`, "success", 8000);
    } else {
      showStatus("Nenhum contrato IslamicPassport encontrado. Faça o deploy do IslamicPassport.sol primeiro (via Remix).", "warning", 8000);
    }

    progressEl.textContent = `Concluído: ${blocksScanned} blocos, ${foundAddrs.length} contrato(s) encontrado(s)${newAddrs.length > 0 ? `, ${newAddrs.length} novo(s)` : ""}.`;

  } catch (err) {
    console.error("[scanBlockchainForContracts] Erro:", err);
    showStatus("Erro ao escanear: " + (err.message || err), "error", 8000);
    progressEl.textContent = "Erro na busca.";
  } finally {
    btnScan.disabled = false;
    btnScan.textContent = "🔍 Buscar";
  }
}

/**
 * Instancia o contrato com o signer atual.
 * Verifica se realmente existe bytecode no endereço antes de configurar.
 * @param {string} addr
 */
async function attachContract(addr) {
  if (!currentAccount) {
    showStatus("Conecte a carteira primeiro.", "warning");
    return;
  }
  // Impede usar o próprio endereço da carteira como contrato
  if (currentAccount && addr.toLowerCase() === currentAccount.toLowerCase()) {
    showStatus("Este é o endereço da sua carteira, não de um contrato. Insira o endereço do contrato implantado.", "error", 8000);
    return;
  }
  try {
    // Tenta verificar bytecode no endereço (via RPC direto — evita cache do BrowserProvider)
    let hasCode = false;
    try {
      const codeHex = await window.ethereum.request({
        method: "eth_getCode",
        params: [addr, "latest"]
      });
      hasCode = codeHex && codeHex !== "0x" && codeHex !== "0x0" && codeHex.length > 4;
      console.log(`[attachContract] eth_getCode(${addr}) => length:${codeHex ? codeHex.length : 0}, hasCode:${hasCode}`);
    } catch (codeErr) {
      console.warn("[attachContract] eth_getCode falhou (prosseguindo):", codeErr.message);
    }

    if (!hasCode) {
      console.warn(`[attachContract] bytecode não detectado para ${addr} (pode ser cache stale do MetaMask)`);
    }

    contractAddress = addr;
    contract = Web3Client.getContractWithSigner(CONTRACT_ABI, addr);
    localStorage.setItem("ip_contractAddress", addr);
    updateContractMetadataUI();

    // Validação ABI em background (sempre tenta, independente do bytecode check)
    const valid = await _isIslamicPassportContract(addr);
    if (valid) {
      showStatus(`Contrato configurado: ${shortAddr(addr)} (ABI verificada ✓)`, "success");
    } else if (hasCode) {
      showStatus(`Contrato configurado: ${shortAddr(addr)} — ⚠️ a ABI pode não corresponder ao contrato implantado.`, "warning", 8000);
    } else {
      showStatus(`Contrato configurado: ${shortAddr(addr)} — bytecode não confirmado (pode ser cache do MetaMask).`, "warning", 8000);
    }

    // Atualiza acesso às abas com base no estado on-chain
    await refreshTabAccess();
    await loadAttestationTypesFromContract();
    await refreshContractMetadata();

  } catch (err) {
    console.error("[attachContract] Erro:", err);
    showStatus("Endereço de contrato inválido: " + err.message, "error");
  }
}

// ═══════════════════════════════════════════════════════════
//  Modal de confirmação de transação
// ═══════════════════════════════════════════════════════════

/**
 * Mostra o modal de confirmação de tx com estimativa de custo.
 * Retorna uma Promise que resolve em true (confirmar) ou false (cancelar).
 * @param {string} actionName
 * @param {string} estimatedETH
 * @param {string} balanceETH
 * @returns {Promise<boolean>}
 */
function showTxConfirmModal(actionName, estimatedETH, balanceETH) {
  return new Promise((resolve) => {
    const modal = document.getElementById("txModal");
    document.getElementById("txModalAction").textContent = actionName;
    document.getElementById("txModalCost").textContent = estimatedETH + " ETH";
    document.getElementById("txModalBalance").textContent = balanceETH + " ETH";

    // Aviso de saldo insuficiente
    const warning = document.getElementById("txModalWarning");
    if (parseFloat(balanceETH) < parseFloat(estimatedETH)) {
      warning.classList.remove("hidden");
    } else {
      warning.classList.add("hidden");
    }

    modal.classList.remove("hidden");

    const btnConfirm = document.getElementById("txModalConfirm");
    const btnCancel = document.getElementById("txModalCancel");

    function cleanup() {
      modal.classList.add("hidden");
      btnConfirm.removeEventListener("click", onConfirm);
      btnCancel.removeEventListener("click", onCancel);
    }
    function onConfirm() { cleanup(); resolve(true); }
    function onCancel()  { cleanup(); resolve(false); }

    btnConfirm.addEventListener("click", onConfirm);
    btnCancel.addEventListener("click", onCancel);
  });
}

/**
 * Mostra overlay de progresso de transação.
 * @param {string} msg
 * @param {string} [txHash]
 */
function showTxOverlay(msg, txHash) {
  const overlay = document.getElementById("txOverlay");
  document.getElementById("txOverlayMsg").textContent = msg;
  document.getElementById("txOverlayHash").textContent = txHash ? `TX: ${txHash}` : "";
  overlay.classList.remove("hidden");
}

/**
 * Esconde o overlay de progresso.
 */
function hideTxOverlay() {
  document.getElementById("txOverlay").classList.add("hidden");
}

// ── Data Loading Overlay (aguardar dados do contrato) ──

let _dataLoadingTimer = null;

/**
 * Mostra overlay bloqueante informando que está aguardando dados do contrato.
 * @param {number} attempt - Número da tentativa atual (1-based)
 * @param {string} [providerLabel] - Qual provider está sendo usado
 */
function showDataLoadingOverlay(attempt, providerLabel) {
  const overlay = document.getElementById("dataLoadingOverlay");
  document.getElementById("dataLoadingAttempt").textContent = attempt;
  if (providerLabel) {
    document.getElementById("dataLoadingProvider").textContent = `Provider: ${providerLabel}`;
  }
  overlay.classList.remove("hidden");

  // Inicia contador de tempo se ainda não existe
  if (!_dataLoadingTimer) {
    const startTime = Date.now();
    const timeEl = document.getElementById("dataLoadingTime");
    _dataLoadingTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      timeEl.textContent = elapsed;
    }, 1000);
  }
}

/**
 * Atualiza a mensagem e tentativa do overlay de carregamento.
 * @param {number} attempt
 * @param {string} msg
 * @param {string} [providerLabel]
 */
function updateDataLoadingOverlay(attempt, msg, providerLabel) {
  document.getElementById("dataLoadingAttempt").textContent = attempt;
  document.getElementById("dataLoadingMsg").textContent = msg;
  if (providerLabel) {
    document.getElementById("dataLoadingProvider").textContent = `Provider: ${providerLabel}`;
  }
}

/**
 * Esconde o overlay de carregamento de dados e limpa o timer.
 */
function hideDataLoadingOverlay() {
  document.getElementById("dataLoadingOverlay").classList.add("hidden");
  if (_dataLoadingTimer) {
    clearInterval(_dataLoadingTimer);
    _dataLoadingTimer = null;
  }
  document.getElementById("dataLoadingTime").textContent = "0";
  document.getElementById("dataLoadingProvider").textContent = "";
}

/**
 * Fluxo completo de transação com confirmação:
 *  1. Estima gas e calcula custo
 *  2. Mostra modal de confirmação
 *  3. Se confirmado, envia tx via MetaMask
 *  4. Mostra overlay de progresso
 *  5. Aguarda confirmação
 *  6. Atualiza saldo
 *
 * @param {string} actionName - Nome legível da ação
 * @param {string} methodName - Nome do método no contrato
 * @param {Array} args - Argumentos do método
 * @returns {Promise<ethers.TransactionReceipt|null>} - Receipt ou null se cancelado
 */
async function executeWithConfirmation(actionName, methodName, args = []) {
  if (!currentAccount) {
    showStatus("Conecte a carteira primeiro.", "warning");
    return null;
  }
  if (!contractAddress || !contract) {
    showStatus("Adicione o endereço do contrato implantado antes de executar transações.", "warning");
    return null;
  }

  // 1. Estimar custo (também valida o contrato — populateTransaction + estimateGas falham se ABI/endereço inválidos)
  let estimatedETH, balanceETH, estimation;
  try {
    showStatus("Estimando custo da transação…", "info", 10000);
    estimation = await Web3Client.estimateTxCost(contract, methodName, args);
    estimatedETH = parseFloat(estimation.estimatedETH).toFixed(6);
    balanceETH = await Web3Client.getBalanceETH(currentAccount);
    balanceETH = parseFloat(balanceETH).toFixed(4);
  } catch (err) {
    console.error("[estimateTxCost] Erro:", err);
    showStatus("Erro ao estimar custo: " + Web3Client.parseError(err), "error", 8000);
    return null;
  }

  // 2. Modal de confirmação
  const confirmed = await showTxConfirmModal(actionName, estimatedETH, balanceETH);
  if (!confirmed) {
    showStatus("Transação cancelada.", "warning", 3000);
    return null;
  }

  // 3. Enviar transação (tipo legado para máxima compatibilidade entre redes)
  let tx;
  try {
    showTxOverlay("Enviando transação… Confirme no MetaMask.");
    // Passa overrides com gasLimit, gasPrice e type 0 (legado) para evitar EIP-1559
    const overrides = {
      gasLimit: estimation.gasLimit,
      gasPrice: estimation.gasPrice,
      type: 0
    };
    tx = await contract[methodName](...args, overrides);
  } catch (err) {
    hideTxOverlay();
    console.error("[sendTx] Erro:", err);
    showStatus(Web3Client.parseError(err), "error", 8000);
    return null;
  }

  // 4. Aguardar confirmação
  try {
    showTxOverlay("Aguardando confirmação…", tx.hash);
    const receipt = await tx.wait();
    hideTxOverlay();
    showStatus(`Transação confirmada! Hash: ${tx.hash}`, "success", 10000);

    // 5. Atualizar saldo
    await refreshBalance();

    return receipt;
  } catch (err) {
    hideTxOverlay();
    showStatus("Erro na confirmação: " + Web3Client.parseError(err), "error", 8000);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  Tabs
// ═══════════════════════════════════════════════════════════

/**
 * Alterna entre as abas.
 * @param {string} tabId
 */
function switchTab(tabId) {
  // Impede navegação para abas desabilitadas
  const tabBtn = document.querySelector(`nav.tabs button[data-tab="${tabId}"]`);
  if (tabBtn && tabBtn.disabled) return;

  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.remove("active"));

  document.getElementById(tabId).classList.add("active");
  tabBtn.classList.add("active");

  // Ações ao entrar na aba
  if (tabId === "tabDashboard") {
    if (!currentAccount) {
      showStatus("Conecte a carteira MetaMask antes de acessar o painel.", "warning");
    } else if (!contractAddress || !contract) {
      showStatus("Adicione o endereço do contrato implantado antes de acessar o painel.", "warning");
    }
    refreshDashboard();
  }
  if (tabId === "tabSheikhs") {
    if (!currentAccount) {
      showStatus("Conecte a carteira MetaMask antes de consultar os sheiks.", "warning");
    } else if (!contractAddress || !contract) {
      showStatus("Adicione o endereço do contrato implantado antes de consultar os sheiks.", "warning");
    }
    refreshSheikhs();
  }
}

// ═══════════════════════════════════════════════════════════
//  A) Registro de perfil
// ═══════════════════════════════════════════════════════════

/**
 * Handler do formulário de registro.
 * @param {Event} e
 */
async function handleRegister(e) {
  e.preventDefault();
  if (!contract) { showStatus("Configure o endereço do contrato.", "warning"); return; }

  const nomeOficial  = document.getElementById("regNomeOficial").value;
  const nomeMuculmano = document.getElementById("regNomeMuçulmano").value;
  const mesquita     = document.getElementById("regMesquita").value;
  const uri          = document.getElementById("regUri").value.trim();

  // Normaliza
  const nNome   = normalize(nomeOficial);
  const nMuslim = normalize(nomeMuculmano);
  const nMosque = normalize(mesquita);

  // Calcula hashes
  const hNome   = hashKeccak(nNome);
  const hMuslim = hashKeccak(nMuslim);
  const hMosque = hashKeccak(nMosque);

  const receipt = await executeWithConfirmation(
    "Registro de Perfil",
    "registerProfile",
    [hNome, hMuslim, hMosque, uri]
  );

  if (receipt) {
    // Imprime hash da transação e IDs/endereços do registro inserido
    console.log(`[handleRegister] TX hash: ${receipt.hash}`);
    console.log(`[handleRegister] Contrato: ${contractAddress}`);
    console.log(`[handleRegister] Conta registrada: ${currentAccount}`);
    console.log(`[handleRegister] Logs no receipt: ${receipt.logs ? receipt.logs.length : 0}`);

    let registeredUserId = null;

    if (receipt.logs && receipt.logs.length > 0) {
      for (let i = 0; i < receipt.logs.length; i++) {
        const log = receipt.logs[i];
        console.log(`[handleRegister] Log[${i}] raw:`, { address: log.address, topics: log.topics, data: log.data });
        try {
          const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
          if (parsed) {
            console.log(`[handleRegister] Log[${i}] parsed event: ${parsed.name}`, parsed.args);
            if (parsed.name === "ProfileRegistered") {
              registeredUserId = parsed.args[1].toString();
              console.log(`[handleRegister] ✅ ProfileRegistered → userId: ${registeredUserId}, address: ${parsed.args[0]}`);
            } else if (parsed.name === "CredentialIssued") {
              console.log(`[handleRegister] ✅ CredentialIssued → credentialId: ${parsed.args[0].toString()}, type: ${CRED_TYPE_NAMES[Number(parsed.args[1])] || parsed.args[1]}, issuer: ${parsed.args[2]}, subject: ${parsed.args[3]}`);
            }
          }
        } catch (parseErr) {
          console.warn(`[handleRegister] Log[${i}] parse falhou (pode ser evento de outro contrato):`, parseErr.message);
        }
      }
    } else {
      console.warn("[handleRegister] Nenhum log encontrado no receipt. Receipt completo:", receipt);
    }

    // Confirmação via getProfile — busca o userId atribuído on-chain
    try {
      const rcCheck = Web3Client.getReadContract(CONTRACT_ABI, contractAddress);
      const prof = await rcCheck.getProfile(currentAccount);
      const onChainId = prof[0].toString();
      const exists = prof[5];
      if (exists) {
        console.log(`[handleRegister] ✅ getProfile confirmou → userId: ${onChainId}, exists: true, address: ${currentAccount}`);
        if (!registeredUserId) registeredUserId = onChainId;
      } else {
        console.warn(`[handleRegister] ⚠️ getProfile retornou exists=false para ${currentAccount} (userId: ${onChainId}). O perfil pode ainda não ter sido minerado.`);
      }
    } catch (profErr) {
      console.warn(`[handleRegister] ⚠️ getProfile falhou após registro:`, profErr.code || profErr.message);
    }

    // Resumo final do registro
    if (registeredUserId) {
      console.log(`[handleRegister] ══ RESUMO: Perfil registrado com userId=${registeredUserId} para ${currentAccount} ══`);
    } else {
      console.warn(`[handleRegister] ⚠️ RESUMO: Registro enviado mas userId NÃO foi obtido dos logs nem do getProfile para ${currentAccount}`);
    }

    // Salva dados pessoais localmente
    saveLocalProfile(currentAccount, {
      nomeOficial: nomeOficial.trim(),
      nomeMuculmano: nomeMuculmano.trim(),
      mesquita: mesquita.trim(),
      uri,
      registeredAt: new Date().toISOString()
    });

    showStatus("Perfil registrado com sucesso!", "success");
    document.getElementById("formRegister").reset();

    // Atualiza acesso às abas (agora registrado → desabilita Registro)
    await refreshTabAccess();

    // Dados do perfil já confirmados pelo receipt — vá direto ao dashboard
    switchTab("tabDashboard");
  }
}

// ═══════════════════════════════════════════════════════════
//  Dashboard
// ═══════════════════════════════════════════════════════════

/**
 * Tenta obter o perfil via um contrato read-only.
 * Retorna o profile ou null se falhar.
 * @param {ethers.Contract} rc
 * @param {string} account
 * @param {string} label - identificador do provider para logs
 * @returns {Promise<Array|null>}
 */
async function _tryGetProfile(rc, account, label) {
  try {
    console.log(`  [${label}] getProfile chamado para address: ${account}`);
    const profile = await rc.getProfile(account);
    const userId = profile[0].toString();
    const exists = profile[5];
    if (exists) {
      console.log(`  [${label}] ✅ getProfile OK → userId: ${userId}, exists: true`, {
        userId,
        hNomeOficial: profile[1],
        hNomeMuculmano: profile[2],
        hMesquita: profile[3],
        uri: profile[4],
        exists
      });
    } else {
      console.log(`  [${label}] getProfile retornou exists=false → perfil NÃO registrado para ${account} (userId retornado: ${userId})`);
    }
    return profile;
  } catch (err) {
    console.warn(`  [${label}] ❌ getProfile FALHOU para address ${account}:`, err.code || err.message);
    return null;
  }
}

/** Máximo de tentativas e intervalo entre cada uma (ms) */
const DASHBOARD_MAX_RETRIES = 5;
const DASHBOARD_RETRY_INTERVAL = 3000;
const DASHBOARD_FIST_INTERVAL = 2000

/**
 * Atualiza o painel do usuário logado.
 * Lê dados do contrato via MetaMask (BrowserProvider).
 * Mostra overlay bloqueante com contador de tempo e tentativas enquanto aguarda.
 * @param {number} _retries - controle interno de tentativas
 */
async function refreshDashboard(_retries = 0) {
  const dashContent = document.getElementById("dashContent");
  const dashNot = document.getElementById("dashNotRegistered");
  const regAlert = document.getElementById("alreadyRegistered");

  if (!currentAccount) {
    dashContent.classList.add("hidden");
    dashNot.classList.remove("hidden");
    dashNot.innerHTML = '⚠️ Conecte sua carteira MetaMask primeiro.';
    regAlert.classList.add("hidden");
    showStatus("Conecte a carteira antes de acessar o painel.", "warning");
    return;
  }

  if (!contractAddress || !contract) {
    dashContent.classList.add("hidden");
    dashNot.classList.remove("hidden");
    dashNot.innerHTML = '⚠️ Configure o endereço do contrato no painel acima antes de consultar o painel.';
    regAlert.classList.add("hidden");
    showStatus("Adicione o endereço do contrato implantado para acessar o painel.", "warning");
    return;
  }

  const attempt = _retries + 1;

  // Mostra overlay bloqueante a partir da 1ª tentativa
  if (_retries === 0) {
    showDataLoadingOverlay(attempt, "MetaMask (BrowserProvider)");
  } else {
    updateDataLoadingOverlay(attempt, `Tentativa ${attempt} de ${DASHBOARD_MAX_RETRIES}… aguardando dados do contrato`, "");
  }

  console.group(`[refreshDashboard] Tentativa ${attempt}/${DASHBOARD_MAX_RETRIES}`);
  console.log("  contractAddress:", contractAddress);
  console.log("  currentAccount:", currentAccount);

  // ── Diagnóstico: verificar rede MetaMask ──
  try {
    const mmChainHex = await window.ethereum.request({ method: "eth_chainId" });
    console.log("  [DIAG] MetaMask chainId:", parseInt(mmChainHex, 16));
  } catch (diagErr) {
    console.warn("  [DIAG] Falha no diagnóstico:", diagErr.message);
  }

  // ── Leitura via MetaMask (BrowserProvider) ──
  let profile = null;

  updateDataLoadingOverlay(attempt, `Tentativa ${attempt} de ${DASHBOARD_MAX_RETRIES}… lendo via MetaMask`, "MetaMask (BrowserProvider)");
  const rc = Web3Client.getReadContract(CONTRACT_ABI, contractAddress);
  profile = await _tryGetProfile(rc, currentAccount, "MetaMask");

  if (!profile) {
    console.warn(`  [refreshDashboard] ❌ Perfil NÃO obtido para ${currentAccount} na tentativa ${attempt}`);
  }

  console.groupEnd();

  // ── Se obteve o perfil, renderiza o dashboard ──
  if (profile) {
    hideDataLoadingOverlay();

    const exists = profile[5]; // bool exists

    if (!exists) {
      dashContent.classList.add("hidden");
      dashNot.classList.remove("hidden");
      dashNot.innerHTML = 'Você ainda não está registrado. Vá até a aba <strong>Registro</strong> primeiro.';
      regAlert.classList.add("hidden");
      return;
    }

    dashNot.classList.add("hidden");
    dashContent.classList.remove("hidden");
    regAlert.classList.remove("hidden"); // mostra aviso na aba registro

    // Usa MetaMask para as demais leituras
    const rcRead = Web3Client.getReadContract(CONTRACT_ABI, contractAddress);

    // DID
    try {
      const did = await rcRead.getDID(currentAccount);
      document.getElementById("dashDID").textContent = did;
    } catch (_) {
      document.getElementById("dashDID").textContent = "(erro ao obter DID)";
    }

    // UserId
    const currentUserId = Number(profile[0]);
    document.getElementById("dashUserId").textContent = currentUserId.toString();

    document.getElementById("dashSuperAdminBadge").classList.toggle("hidden", currentUserId !== 1);

    try {
      const sheik = await rcRead.isSheikh(currentAccount);
      document.getElementById("dashSheikBadge").classList.toggle("hidden", !sheik);
    } catch (_) {
      document.getElementById("dashSheikBadge").classList.add("hidden");
    }

    const roleHint = document.getElementById("dashRoleHint");
    if (currentUserId === 1 && !isSheik) {
      roleHint.textContent = "Esta carteira é o SuperAdmin da V2 e pode nomear o primeiro sheik.";
      roleHint.classList.remove("hidden");
    } else if (currentUserId === 1 && isSheik) {
      roleHint.textContent = "Esta carteira é o SuperAdmin e também possui certificado ativo de sheik.";
      roleHint.classList.remove("hidden");
    } else if (isSheik) {
      roleHint.textContent = "Esta carteira possui certificado ativo de sheik.";
      roleHint.classList.remove("hidden");
    } else {
      roleHint.textContent = "";
      roleHint.classList.add("hidden");
    }

    // Credenciais
    try {
      const credIds = await rcRead.getCredentialsOf(currentAccount);
      const container = document.getElementById("dashCredentials");
      container.innerHTML = "";

      if (credIds.length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Nenhuma credencial encontrada.</p>';
        return;
      }

      for (const cid of credIds) {
        const c = await rcRead.getCredential(cid);
        const div = document.createElement("div");
        div.className = `cred-card ${c[7] ? "revoked" : ""}`;

        const typeName = CRED_TYPE_NAMES[Number(c[1])] || "UNKNOWN";
        const badgeCls = CRED_BADGE_CLASS[Number(c[1])] || "badge-initial";

        div.innerHTML = `
          <div class="cred-header">
            <span class="badge ${badgeCls}">${typeName}</span>
            ${c[7] ? '<span class="badge badge-revoked">REVOGADA</span>' : ""}
            <span style="font-size:0.8rem;color:var(--text-secondary);">#${c[0].toString()}</span>
          </div>
          <div class="cred-detail">
            <strong>Issuer:</strong> ${c[2] === contractAddress ? "Contrato (auto)" : shortAddr(c[2])}<br/>
            <strong>Emitida em:</strong> ${formatTs(c[6])}<br/>
            <strong>ClaimHash:</strong> ${c[4] !== ethers.ZeroHash ? c[4] : "—"}<br/>
            ${c[5] ? `<strong>URI:</strong> ${c[5]}<br/>` : ""}
          </div>
        `;
        container.appendChild(div);
      }
    } catch (credErr) {
      console.warn("[refreshDashboard] Erro ao carregar credenciais:", credErr.message);
    }

    return;
  }

  // ── Perfil não obtido — tentar novamente ou desistir ──
  if (_retries < DASHBOARD_MAX_RETRIES - 1) {
    const interval = _retries === 0 ? DASHBOARD_FIST_INTERVAL : DASHBOARD_RETRY_INTERVAL;
    console.log(`[refreshDashboard] Perfil não disponível. Próxima tentativa em ${interval / 1000}s… (tentativa ${attempt + 1}/${DASHBOARD_MAX_RETRIES})`);
    updateDataLoadingOverlay(attempt, `Dados ainda não disponíveis. Próxima tentativa em ${interval / 1000}s…`, "Aguardando…");
    await new Promise(r => setTimeout(r, interval));
    return refreshDashboard(_retries + 1);
  }

  // Esgotou tentativas
  hideDataLoadingOverlay();
  dashContent.classList.add("hidden");
  dashNot.classList.add("hidden");
  showStatus(`⚠️ Não foi possível ler os dados do contrato após ${DASHBOARD_MAX_RETRIES} tentativas. Verifique se a rede está acessível via MetaMask e se o contrato foi implantado.`, "error", 10000);
}

// ═══════════════════════════════════════════════════════════
//  Sheikhs
// ═══════════════════════════════════════════════════════════

/**
 * Carrega e exibe a lista de sheiks.
 */
async function refreshSheikhs() {
  if (!currentAccount) {
    showStatus("Conecte a carteira antes de consultar os sheiks.", "warning");
    return;
  }
  if (!contractAddress || !contract) {
    showStatus("Adicione o endereço do contrato implantado antes de consultar os sheiks.", "warning");
    return;
  }

  try {
    const rcSheikhs = Web3Client.getReadContract(CONTRACT_ABI, contractAddress);
    const sheikhs = await rcSheikhs.listSheikhs();
    const tbody = document.getElementById("sheikhTableBody");
    tbody.innerHTML = "";

    if (sheikhs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-secondary);">Nenhum sheik registrado ainda.</td></tr>';
      return;
    }

    for (let i = 0; i < sheikhs.length; i++) {
      const addr = sheikhs[i];
      let did = "";
      try { did = await rcSheikhs.getDID(addr); } catch (_) { did = "—"; }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td class="text-mono">${addr}</td>
        <td class="text-mono" style="font-size:0.75rem;">${did}</td>
      `;
      tbody.appendChild(tr);
    }

  } catch (err) {
    showStatus("Erro ao listar sheiks: " + (err.reason || err.message), "error");
  }
}

async function handleIssue(e) {
  e.preventDefault();
  if (!contract) { showStatus("Configure o contrato.", "warning"); return; }

  const typeKey = document.getElementById("issueType").value || defaultAttestationType;
  const meta = attestationTypeCatalog.get(typeKey);
  if (!meta) {
    showStatus("Tipo de credencial inválido.", "error");
    return;
  }
  if (!isTypePermitted(typeKey)) {
    showStatus("Você não possui permissão para emitir este tipo de credencial.", "warning");
    return;
  }

  const subject = document.getElementById("issueSubject").value.trim();
  const uri = document.getElementById("issueUri").value.trim();

  if (!ethers.isAddress(subject)) {
    showStatus("Endereço inválido.", "error");
    return;
  }

  const buildClaims = meta.buildClaims || (() => ({ issuedBy: currentAccount }));
  const vc = buildVCJson({
    type: meta.vcType || meta.key,
    issuer: `did:ethr:${currentChainId}:${currentAccount}`,
    subject: `did:ethr:${currentChainId}:${subject}`,
    claims: { ...buildClaims(), attestationType: typeKey },
    issuedAt: BigInt(Math.floor(Date.now() / 1000))
  });
  const claimHash = vcClaimHash(vc);

  const actionName = `Emitir ${meta.label}`;
  const receipt = await executeWithConfirmation(
    actionName,
    meta.contractMethod || "attestMuslim",
    [subject, claimHash, uri]
  );

  if (receipt) {
    console.log(`[handleIssue] ${actionName} TX hash: ${receipt.hash}`);
    const successMsg = meta.successMessage || `${meta.label} emitido com sucesso!`;
    showStatus(successMsg, "success");
    document.getElementById("formIssue").reset();
    document.getElementById("issueType").value = defaultAttestationType;
    updateIssueRulesHint();
  }
}

// ═══════════════════════════════════════════════════════════
//  E) Revogação
// ═══════════════════════════════════════════════════════════

/**
 * Handler do formulário de revogação.
 * @param {Event} e
 */
async function handleRevoke(e) {
  e.preventDefault();
  if (!contract) { showStatus("Configure o contrato.", "warning"); return; }

  const credId = document.getElementById("revokeCredId").value.trim();

  const receipt = await executeWithConfirmation(
    `Revogar Credencial #${credId}`,
    "revokeCredential",
    [credId]
  );

  if (receipt) {
    console.log(`[handleRevoke] TX hash: ${receipt.hash}`);
    console.log(`[handleRevoke] Contrato: ${contractAddress}`);
    console.log(`[handleRevoke] Logs no receipt: ${receipt.logs ? receipt.logs.length : 0}`);
    if (receipt.logs && receipt.logs.length > 0) {
      for (let i = 0; i < receipt.logs.length; i++) {
        const log = receipt.logs[i];
        try {
          const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
          if (parsed && parsed.name === "CredentialRevoked") {
            console.log(`[handleRevoke] ✅ CredentialRevoked → credentialId: ${parsed.args[0].toString()}, revokedBy: ${parsed.args[1]}`);
          }
        } catch (parseErr) {
          console.warn(`[handleRevoke] Log[${i}] parse falhou:`, parseErr.message);
        }
      }
    } else {
      console.warn("[handleRevoke] Nenhum log no receipt.", receipt);
    }

    showStatus(`Credencial #${credId} revogada com sucesso!`, "success");
    document.getElementById("formRevoke").reset();
  }
}

// ═══════════════════════════════════════════════════════════
//  B) Solicitar atesto (off-chain)
// ═══════════════════════════════════════════════════════════

/**
 * Gera JSON de pedido de atesto off-chain.
 * @param {Event} e
 */
function handleRequest(e) {
  e.preventDefault();

  const sheikhAddr = document.getElementById("reqSheikh").value.trim();
  const message = document.getElementById("reqMessage").value.trim();

  if (!ethers.isAddress(sheikhAddr)) {
    showStatus("Endereço de sheik inválido.", "error");
    return;
  }

  const request = {
    type: "AttestationRequest",
    subject: currentAccount,
    subjectDID: `did:ethr:${currentChainId}:${currentAccount}`,
    sheikh: sheikhAddr,
    sheikhDID: `did:ethr:${currentChainId}:${sheikhAddr}`,
    message: message || null,
    timestamp: new Date().toISOString(),
    requestHash: hashKeccak(
      JSON.stringify({ subject: currentAccount, sheikh: sheikhAddr, ts: Date.now() })
    )
  };

  const output = document.getElementById("requestOutput");
  const textarea = document.getElementById("requestJSON");
  textarea.value = JSON.stringify(request, null, 2);
  output.classList.remove("hidden");

  showStatus("Pedido gerado! Copie ou baixe o JSON e envie ao sheik.", "success");
}

// ═══════════════════════════════════════════════════════════
//  Exportar / Importar VC JSON (dados locais)
// ═══════════════════════════════════════════════════════════

/**
 * Exporta dados locais do perfil como VC JSON.
 */
async function exportVC() {
  if (!currentAccount) { showStatus("Conecte a carteira.", "warning"); return; }

  const local = loadLocalProfile(currentAccount);
  if (!local) {
    showStatus("Nenhum dado local encontrado para exportar. Registre-se primeiro.", "warning");
    return;
  }

  // Monta VC INITIAL com dados locais
  const vc = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", "IslamicPassportProfile"],
    issuer: `did:ethr:${currentChainId}:${contractAddress}`,
    issuanceDate: local.registeredAt,
    credentialSubject: {
      id: `did:ethr:${currentChainId}:${currentAccount}`,
      nomeOficial: local.nomeOficial,
      nomeMuculmano: local.nomeMuculmano,
      mesquita: local.mesquita,
      uri: local.uri || ""
    }
  };

  downloadJSON(vc, `islamic-passport-vc-${shortAddr(currentAccount)}.json`);
  showStatus("VC JSON exportado com sucesso!", "success");
}

/**
 * Importa VC JSON e salva no localStorage.
 * @param {Event} e
 */
function importVC(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (ev) {
    try {
      const vc = JSON.parse(ev.target.result);
      if (vc.credentialSubject) {
        const data = {
          nomeOficial: vc.credentialSubject.nomeOficial || "",
          nomeMuculmano: vc.credentialSubject.nomeMuculmano || "",
          mesquita: vc.credentialSubject.mesquita || "",
          uri: vc.credentialSubject.uri || "",
          registeredAt: vc.issuanceDate || new Date().toISOString()
        };
        saveLocalProfile(currentAccount, data);
        showStatus("VC importado com sucesso! Dados locais atualizados.", "success");
      } else {
        showStatus("Formato de VC inválido.", "error");
      }
    } catch (err) {
      showStatus("Erro ao ler arquivo: " + err.message, "error");
    }
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════════
//  Event listeners (DOMContentLoaded)
// ═══════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  updateContractMetadataUI();

  // ── Estado inicial: desabilitar botões on-chain ──
  setOnchainButtonsEnabled(false);
  refreshAttestationTypeSelects();
  refreshTabAccess();

  // ── Conectar carteira ──
  document.getElementById("btnConnect").addEventListener("click", connectWallet);
  document.getElementById("btnConnectCenter").addEventListener("click", connectWallet);

  // ── Desconectar carteira ──
  document.getElementById("btnDisconnect").addEventListener("click", disconnectWallet);

  // ── Adicionar contrato ──
  document.getElementById("btnAddContract").addEventListener("click", () => {
    const addr = document.getElementById("inputContractAddr").value.trim();
    addContractAddress(addr);
  });

  // ── Remover contrato selecionado ──
  document.getElementById("btnRemoveContract").addEventListener("click", removeSelectedContract);

  // ── Buscar contratos na blockchain ──
  document.getElementById("btnScanContracts").addEventListener("click", scanBlockchainForContracts);

  const contractScanManualInput = document.getElementById("contractScanManualInput");
  if (contractScanManualInput) {
    contractScanManualInput.addEventListener("input", handleContractScanManualInput);
  }

  const contractScanAcceptBtn = document.getElementById("contractScanAccept");
  if (contractScanAcceptBtn) {
    contractScanAcceptBtn.addEventListener("click", () => { handleContractScanAccept(); });
  }

  const contractScanRescanBtn = document.getElementById("contractScanRescan");
  if (contractScanRescanBtn) {
    contractScanRescanBtn.addEventListener("click", () => {
      if (contractScanModalState.running) return;
      contractScanModalState.foundAddress = null;
      contractScanModalState.foundBlock = null;
      setContractScanResult(null, null);
      runContractScanModal();
    });
  }

  const contractScanReconnectBtn = document.getElementById("contractScanReconnect");
  if (contractScanReconnectBtn) {
    contractScanReconnectBtn.addEventListener("click", () => {
      connectWallet();
    });
  }

  // ── Selecionar contrato do combobox ──
  document.getElementById("selectContract").addEventListener("change", (e) => {
    const addr = e.target.value;
    if (addr) attachContract(addr);
  });

  // ── Selecionar conta do combobox ──
  document.getElementById("selectAccount").addEventListener("change", async (e) => {
    const addr = e.target.value;
    if (!addr) return;

    if (!Web3Client.isMetaMaskAvailable()) {
      showStatus("MetaMask não encontrado. Instale a extensão para continuar.", "error");
      return;
    }

    if (_connecting) {
      showStatus("Já existe uma solicitação de conexão pendente.", "info", 4000);
      return;
    }

    if (currentAccount && addr.toLowerCase() === currentAccount.toLowerCase()) {
      await refreshTabAccess();
      return;
    }

    showStatus("Selecione a conta desejada no MetaMask para continuar.", "info", 6000);
    await connectWallet();
  });

  // ── Tabs ──
  document.querySelectorAll("nav.tabs button").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // ── Registro ──
  const formRegister = document.getElementById("formRegister");
  if (formRegister) {
    formRegister.addEventListener("submit", handleRegister);
  }

  // ── Emissão unificada ──
  const formIssue = document.getElementById("formIssue");
  if (formIssue) {
    formIssue.addEventListener("submit", handleIssue);

    const issueRequestTextarea = document.getElementById("issueRequestJSON");
    if (issueRequestTextarea) {
      const handleParseIssueJson = () => {
        const parsed = parseIssueRequestJson({ silent: true });
        if (parsed && !parsed.error) {
          autofillIssueFieldsFromRequest(parsed, { showFeedback: true });
        }
      };
      ["blur", "change"].forEach(evt => issueRequestTextarea.addEventListener(evt, handleParseIssueJson));
    }

    const issueJsonFileInput = document.getElementById("issueJsonFile");
    if (issueJsonFileInput) {
      issueJsonFileInput.addEventListener("change", handleIssueJsonFileChange);
    }

    const issueTypeSelect = document.getElementById("issueType");
    if (issueTypeSelect) {
      issueTypeSelect.addEventListener("change", updateIssueRulesHint);
    }
  }

  // ── Revogação ──
  const formRevoke = document.getElementById("formRevoke");
  if (formRevoke) {
    formRevoke.addEventListener("submit", handleRevoke);
  }

  // ── Solicitar atesto ──
  const formRequest = document.getElementById("formRequest");
  if (formRequest) {
    formRequest.addEventListener("submit", handleRequest);
  }

  // ── Copiar pedido ──
  document.getElementById("btnCopyRequest").addEventListener("click", () => {
    const txt = document.getElementById("requestJSON").value;
    navigator.clipboard.writeText(txt).then(() => showStatus("Copiado!", "success", 2000));
  });

  // ── Download pedido ──
  document.getElementById("btnDownloadRequest").addEventListener("click", () => {
    const txt = document.getElementById("requestJSON").value;
    try {
      downloadJSON(JSON.parse(txt), `attest-request-${Date.now()}.json`);
    } catch (_) { /* ignore */ }
  });

  // ── Atualizar sheiks ──
  document.getElementById("btnRefreshSheikhs").addEventListener("click", refreshSheikhs);

  // ── Exportar VC ──
  document.getElementById("btnExportVC").addEventListener("click", exportVC);

  // ── Importar VC ──
  document.getElementById("btnImportVC").addEventListener("click", () => {
    document.getElementById("fileImportVC").click();
  });
  document.getElementById("fileImportVC").addEventListener("change", importVC);

  // ── MetaMask: escutar troca de conta/chain ──
  Web3Client.listenMetaMaskEvents(
    (accounts) => {
      // Conta mudou — recarrega para atualizar tudo
      location.reload();
    },
    (chainIdHex) => {
      // Rede mudou — recarrega
      location.reload();
    }
  );

  // ── Restaurar contratos salvos (só preenche o input para mostrar) ──
  const savedAddr = localStorage.getItem("ip_contractAddress");
  if (savedAddr) {
    document.getElementById("inputContractAddr").value = savedAddr;
  }

  // ── Mostrar painel de carteira se já tiver contratos salvos ──
  const rawList = localStorage.getItem("ip_contractList");
  if (rawList) {
    try {
      contractList = JSON.parse(rawList);
      renderContractSelect();
    } catch (_) {}
  }
});
