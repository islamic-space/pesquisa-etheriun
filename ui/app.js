/**
 * @file app.js
 * @description Interface web para o contrato IslamicPassport.
 *              Usa ethers.js v6 + web3Client.js para conectar ao MetaMask e interagir com o contrato.
 *              Dados pessoais são mantidos localmente; apenas hashes vão on-chain.
 *              Todas as transações passam por modal de confirmação com estimativa de gas.
 */

// ═══════════════════════════════════════════════════════════
//  ABI mínima do contrato IslamicPassport (incluindo PrayerRegistry)
// ═══════════════════════════════════════════════════════════

const CONTRACT_ABI = [
  // ── Escrita ──
  "function registerProfile(bytes32 hNomeOficial, bytes32 hNomeMuculmano, bytes32 hMesquita, string optionalUri) external",
  "function attestMuslim(address subject, bytes32 claimHash, string optionalUri) external",
  "function promoteToSheikh(address subject, bytes32 claimHash, string optionalUri) external",
  "function revokeCredential(uint256 credentialId) external",
  "function createDynamicCertificateType((string name,string description,uint8 audienceRule,uint256[] prerequisiteTypeIds,uint8 category,bool isPublic,address payoutAddress,uint256 publicationFee,address[] authorizedSheikhs) input) external returns (uint256)",
  "function updateDynamicCertificateType(uint256 typeId,(string name,string description,uint8 audienceRule,uint256[] prerequisiteTypeIds,uint8 category,bool isPublic,address payoutAddress,uint256 publicationFee,address[] authorizedSheikhs) input) external",
  "function issueDynamicCertificate(uint256 typeId,address subject,bytes32 claimHash,string optionalUri) external returns (uint256)",
  "function payDynamicCredentialPublication(uint256 credentialId) external payable",

  // ── Prayer Registry (escrita) ──
  "function managePrayerLocation((bool createNewLocation, uint256 existingLocationId, (string name, uint8 locationType, string geoReference, bool sufiFriendly, string sufiOrder) locationInput)) external returns (uint256 locationId)",
  "function assignSheikhToLocation(address sheikh, (bool createNewLocation, uint256 existingLocationId, (string name, uint8 locationType, string geoReference, bool sufiFriendly, string sufiOrder) locationInput)) external",
  "function transferSheikhToLocation(address sheikh, uint256 targetLocationId) external",
  "function removeSheikhFromLocation(address sheikh) external",
  "function requestPrayerLocationMembership(uint256 locationId) external",
  "function cancelPrayerLocationMembershipRequest(uint256 locationId) external",
  "function approvePrayerLocationMembership(address requester, uint256 locationId) external",
  "function grantPrayerLocationMembership(address member, uint256 locationId) external",
  "function removePrayerLocationMember(address member) external",
  "function donateZakatOrSadaqah((uint256 amount, uint8 beneficiaryType, uint256 locationId, address beneficiaryAddress) payload, string note, bytes32 claimHash, string optionalUri) external payable",

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
  "function totalDynamicCertificateTypes() view returns (uint256)",
  "function listDynamicCertificateTypes() view returns ((uint256 id, bytes32 slug, string name, string description, uint8 audienceRule, uint256[] prerequisiteTypeIds, uint8 category, bool isPublic, uint256 createdAt, address createdBy, uint256 publicationFee, address payoutAddress, address[] authorizedSheikhs, bool exists)[])",
  "function getDynamicCertificateType(uint256 typeId) view returns (uint256 id, bytes32 slug, string name, string description, uint8 audienceRule, uint256[] prerequisiteTypeIds, uint8 category, bool isPublic, uint256 createdAt, address createdBy, uint256 publicationFee, address payoutAddress, address[] authorizedSheikhs, bool exists)",
  "function getDynamicCertificateAuthorizedSheikhs(uint256 typeId) view returns (address[])",
  "function isAuthorizedForDynamicCertificate(uint256 typeId, address sheikh) view returns (bool)",
  "function getDynamicCredentialStatus(uint256 credentialId) view returns (uint256 typeId, bool published, uint256 publicationFee, address payoutAddress, uint256 paidAmount)",
  "function getActiveDynamicCredential(address subject, uint256 typeId) view returns (uint256)",

  // ── Prayer Registry (leitura) ──
  "function listPrayerLocationIds() view returns (uint256[])",
  "function getPrayerLocation(uint256 locationId) view returns ((uint256 id, string name, uint8 locationType, string geoReference, bool sufiFriendly, string sufiOrder, uint256 createdAt, address createdBy, bool exists) core, address[] sheikhs, uint256 memberCount)",
  "function getPrayerLocationCore(uint256 locationId) view returns (uint256 id, string name, uint8 locationType, string geoReference, bool sufiFriendly, string sufiOrder, uint256 createdAt, address createdBy, bool exists)",
  "function getPrayerLocationSheikhs(uint256 locationId) view returns (address[])",
  "function getSheikhPrayerLocation(address sheikh) view returns (uint256)",
  "function getMemberPrayerLocation(address member) view returns ((uint256 locationId, uint256 joinedAt, address addedBy))",
  "function hasPendingPrayerRequest(address member) view returns (bool)",

  // ── Eventos ──
  "event ProfileRegistered(address indexed user, uint256 indexed userId, bytes32 hNomeOficial, bytes32 hNomeMuculmano, bytes32 hMesquita, string uri)",
  "event CredentialIssued(uint256 indexed credentialId, uint8 credType, address indexed issuer, address indexed subject, bytes32 claimHash, string uri)",
  "event AttestedMuslim(address indexed issuer, address indexed subject, uint256 indexed credentialId)",
  "event SheikhPromoted(address indexed issuer, address indexed subject, uint256 indexed credentialId)",
  "event CredentialRevoked(uint256 indexed credentialId, address indexed revokedBy)",
  "event DynamicCertificateTypeCreated(uint256 indexed typeId, bytes32 indexed slug, address indexed createdBy, string name, string emojiLog)",
  "event DynamicCertificateTypeUpdated(uint256 indexed typeId, bytes32 indexed slug, address indexed updatedBy, string name, string emojiLog)",
  "event DynamicCertificateIssued(uint256 indexed credentialId, uint256 indexed typeId, address indexed subject, address issuer, string emojiLog)",
  "event DynamicCredentialPublicationPaid(uint256 indexed credentialId, address indexed payer, uint256 amount, address payout, string emojiLog)",

  // ── Prayer Registry (eventos) ──
  "event PrayerLocationSaved(uint256 indexed locationId, address indexed operator, string emojiLog)",
  "event SheikhAssignedToLocation(uint256 indexed locationId, address indexed sheikh, address indexed operator, string emojiLog)",
  "event SheikhTransferred(uint256 indexed fromLocationId, uint256 indexed toLocationId, address indexed sheikh, string emojiLog)",
  "event SheikhRemoved(uint256 indexed locationId, address indexed sheikh, address indexed operator, string emojiLog)",
  "event MembershipRequested(address indexed requester, uint256 indexed locationId, string emojiLog)",
  "event MembershipCancelled(address indexed requester, uint256 indexed locationId, string emojiLog)",
  "event MembershipApproved(address indexed requester, uint256 indexed locationId, address indexed operator, string emojiLog)",
  "event MembershipGranted(address indexed member, uint256 indexed locationId, address indexed operator, string emojiLog)",
  "event MembershipRemoved(address indexed member, uint256 indexed locationId, address indexed operator, string emojiLog)",
  "event DonationRecorded(address indexed donor, uint256 indexed locationId, (uint256 amount, uint8 beneficiaryType, uint256 locationId, address beneficiaryAddress) payload, string note, string emojiLog)"
];

const dynamicState = {
  loaded: false,
  items: [],
  map: new Map(),
  form: {
    editingTypeId: null,
    selectedPrereqs: [],
    selectedSheikhs: []
  },
  lastStatus: null
};

const dynamicFilters = {
  prereqAvailable: "",
  prereqSelected: "",
  sheikhAvailable: "",
  sheikhSelected: ""
};

const dynamicIssueContext = {
  parsed: null,
  canonicalPayload: null,
  derivedSubject: null,
  derivedUri: null
};

function resetDynamicIssueContext() {
  dynamicIssueContext.parsed = null;
  dynamicIssueContext.canonicalPayload = null;
  dynamicIssueContext.derivedSubject = null;
  dynamicIssueContext.derivedUri = null;
}

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

/** @type {ethers.Contract|null} Fonte atual de eventos on-chain */
let contractEventSource = null;

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

const DYNAMIC_AUDIENCE_LABELS = [
  "Qualquer pessoa",
  "Somente muçulmanos",
  "Somente sheiks",
  "Requer certificados dinâmicos"
];

const DYNAMIC_CATEGORY_LABELS = ["Palestra", "Curso", "Evento", "Dawa", "Outros"];

const LOCATION_TYPE_LABELS = ["Mesquita", "Musallah", "Zawiya", "Outro"];

const SUFI_ORDERS = [
  { key: "", label: "Nenhuma" },
  { key: "Chishti", label: "Chishti" },
  { key: "Mevlevi", label: "Mevlevi" },
  { key: "Naqshbandi", label: "Naqshbandi" },
  { key: "Tijaniyyah", label: "Tijaniyyah" },
  { key: "Qadiriyya", label: "Qadiriyya" },
  { key: "Rifa'iyya", label: "Rifa'iyya" },
  { key: "Shadhiliyya", label: "Shadhiliyya" },
  { key: "Bektashi", label: "Bektashi" },
  { key: "Kubrawiya", label: "Kubrawiya" },
  { key: "Suhrawardiyya", label: "Suhrawardiyya" }
];

/**
 * Seletores de botões on-chain que devem ser desabilitados quando desconectado.
 */
const ONCHAIN_BUTTONS_SELECTOR = [
  '#formRegister button[type="submit"]',
  '#formIssue button[type="submit"]',
  '#formRevoke button[type="submit"]',
  '#btnExportVC',
  '#btnRefreshSheikhs',
  '#btnDynamicSubmit',
  '#formDynamicIssue button[type="submit"]',
  '#btnDynamicPublish',
  '#formLocationCreate button[type="submit"]',
  '#btnRefreshLocations',
  '#formAssignSheikh button[type="submit"]',
  '#formPromoteSheikh button[type="submit"]',
  '#formIssueSufi button[type="submit"]',
  '#formTransferSheikh button[type="submit"]',
  '#formRemoveSheikhFromLocation button[type="submit"]',
  '#formDonate button[type="submit"]',
  '#btnRefreshDonations'
].join(",");

/**
 * Catálogo dinâmico de tipos de credencial retornados pelo contrato.
 * Estrutura por chave (ex.: MUSLIM_ATTESTATION).
 */
const attestationTypeCatalog = new Map();
const AUTO_ISSUED_TYPES = new Set(["INITIAL"]);
const autoIssuedTypeLog = new Set();

/** Marca quais recursos opcionais o contrato suporta. */
const contractCapabilities = {
  identifyContract: true,
  attestationCatalog: true,
  dynamicCertificates: true
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

function parseDynamicIssueJson(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    showStatus("⚠️ JSON inválido para o certificado dinâmico.", "error");
    throw err;
  }
}

function deriveDynamicUriFromJson(json) {
  const candidates = [
    json?.uri,
    json?.metadataUri,
    json?.credential?.uri,
    json?.credential?.metadataUri,
    json?.proof?.uri,
    json?.credentialSubject?.uri
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function deriveDynamicSubjectFromJson(json) {
  const candidates = [
    json?.subject,
    json?.subjectAddress,
    json?.credentialSubject?.id,
    json?.credentialSubject?.address,
    json?.credentialSubject?.wallet,
    json?.credentialSubject?.ethAddress,
    json?.credentialSubject?.ethereumAddress
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && ethers.isAddress(candidate)) {
      return candidate;
    }
  }
  return null;
}

function hydrateDynamicIssueFormFromJson(json) {
  if (!json || typeof json !== "object") return;
  dynamicIssueContext.parsed = json;
  dynamicIssueContext.canonicalPayload = canonicalStringify(json);
  dynamicIssueContext.derivedSubject = deriveDynamicSubjectFromJson(json);
  dynamicIssueContext.derivedUri = deriveDynamicUriFromJson(json);

  const subjectInput = document.getElementById("dynamicIssueSubject");
  const uriInput = document.getElementById("dynamicIssueUri");
  if (dynamicIssueContext.derivedSubject && subjectInput && !subjectInput.value.trim()) {
    subjectInput.value = dynamicIssueContext.derivedSubject;
  }
  if (uriInput && !uriInput.value.trim() && dynamicIssueContext.derivedUri) {
    uriInput.value = dynamicIssueContext.derivedUri;
  }
}

function handleDynamicIssueJsonChange() {
  const textarea = document.getElementById("dynamicIssueJSON");
  if (!textarea) return;
  const raw = textarea.value.trim();
  if (!raw) {
    resetDynamicIssueContext();
    return;
  }
  try {
    const parsed = parseDynamicIssueJson(raw);
    hydrateDynamicIssueFormFromJson(parsed);
  } catch (_) {
    // parseDynamicIssueJson já mostrou alerta
  }
}

async function handleDynamicIssueFileChange(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const textarea = document.getElementById("dynamicIssueJSON");
    textarea.value = text.trim();
    handleDynamicIssueJsonChange();
    showStatus(`📄 JSON carregado (${file.name}).`, "info");
  } catch (err) {
    showStatus("⚠️ Não foi possível ler o arquivo JSON.", "error");
    console.warn("[handleDynamicIssueFileChange]", err.message);
  } finally {
    event.target.value = "";
  }
}

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
ensureDefaultAttestationType();

/** @type {{address: string, did: string}[]} */
let sheikhDirectory = [];
const sheikhDirectoryIndex = new Map();
const sheikhDidIndex = new Map();

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

function isSelectableAttestationType(key) {
  if (!key) return false;
  const selectable = !AUTO_ISSUED_TYPES.has(key);
  if (!selectable && !autoIssuedTypeLog.has(key)) {
    autoIssuedTypeLog.add(key);
    console.info(
      `🤖 [AttestationCatalog] Tipo ${key} é emitido automaticamente e foi ocultado dos formulários manuais.`
    );
  }
  return selectable;
}

function getFirstSelectableAttestationType() {
  for (const key of attestationTypeCatalog.keys()) {
    if (isSelectableAttestationType(key)) {
      return key;
    }
  }
  return null;
}

function ensureDefaultAttestationType() {
  const candidate = getFirstSelectableAttestationType();
  if (candidate) {
    defaultAttestationType = candidate;
  } else if (!defaultAttestationType || AUTO_ISSUED_TYPES.has(defaultAttestationType)) {
    defaultAttestationType = "MUSLIM_ATTESTATION";
  }
}

function getFirstPermittedAttestationType() {
  const types = Array.from(attestationTypeCatalog.keys()).filter(isSelectableAttestationType);
  const preferred = types.find((key) => isTypePermitted(key));
  return preferred || defaultAttestationType;
}

function populateAttestationTypeSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  attestationTypeCatalog.forEach((meta, key) => {
    if (!isSelectableAttestationType(key)) return;
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
  ensureDefaultAttestationType();
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
  if (!isSelectableAttestationType(key)) return false;
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
    ensureDefaultAttestationType();
  } catch (err) {
    if (isMissingFunctionError(err)) {
      contractCapabilities.attestationCatalog = false;
      console.warn("[loadAttestationTypesFromContract] Contrato legacy sem catálogo on-chain. Usando fallback local.");
    } else {
      console.warn("[loadAttestationTypesFromContract] Falhou, usando fallback:", err.message);
    }
    attestationTypeCatalog.clear();
    FALLBACK_ATTESTATION_TYPES.forEach((item) => attestationTypeCatalog.set(item.key, item));
    ensureDefaultAttestationType();
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

function rebuildSheikhDirectorySnapshot() {
  sheikhDirectory = Array.from(sheikhDirectoryIndex.values());
  updateSheikhDirectoryList();
}

function rememberSheikhIdentity(address, extra = {}, options = {}) {
  const { silent = false } = options;
  if (!address) return null;
  let checksum;
  try {
    checksum = ethers.getAddress(address);
  } catch (_) {
    checksum = address;
  }
  const key = checksum.toLowerCase();
  const previous = sheikhDirectoryIndex.get(key);
  if (previous?.did) {
    sheikhDidIndex.delete(previous.did.toLowerCase());
  }
  const updated = {
    ...previous,
    address: checksum,
    ...extra
  };
  sheikhDirectoryIndex.set(key, updated);
  if (updated.did) {
    sheikhDidIndex.set(updated.did.toLowerCase(), updated);
  }
  if (!silent) {
    rebuildSheikhDirectorySnapshot();
  }
  return updated;
}

function replaceSheikhDirectory(entries) {
  sheikhDirectoryIndex.clear();
  sheikhDidIndex.clear();
  entries.forEach((entry) => {
    if (!entry?.address) return;
    rememberSheikhIdentity(entry.address, { did: entry.did || null }, { silent: true });
  });
  rebuildSheikhDirectorySnapshot();
  refreshDynamicSheikhOptions();
}

function isDynamicTabVisible() {
  const tab = document.getElementById("tabDynamicButton");
  return tab && !tab.classList.contains("hidden");
}

function refreshDynamicSheikhOptions() {
  if (!isDynamicTabVisible()) return;
  renderDynamicSheikhLists();
}

// ═══════════════════════════════════════════════════════════
//  Certificados dinâmicos — helpers de UI e estado
// ═══════════════════════════════════════════════════════════

function normalizeDynamicTypeEntity(raw) {
  if (!raw) return null;
  return {
    id: Number(raw.id),
    slug: raw.slug,
    name: raw.name,
    description: raw.description,
    audienceRule: Number(raw.audienceRule),
    prerequisiteTypeIds: (raw.prerequisiteTypeIds || []).map((value) => Number(value)),
    category: Number(raw.category),
    isPublic: Boolean(raw.isPublic),
    createdAt: Number(raw.createdAt),
    createdBy: raw.createdBy,
    publicationFee: raw.publicationFee,
    payoutAddress: raw.payoutAddress,
    authorizedSheikhs: raw.authorizedSheikhs || [],
    exists: raw.exists
  };
}

function weiToGwei(value) {
  if (!value) return "0";
  try {
    return ethers.formatUnits(value, "gwei");
  } catch (_) {
    return "0";
  }
}

function gweiToWei(value) {
  if (!value) return 0n;
  try {
    return ethers.parseUnits(String(value), "gwei");
  } catch (_) {
    return 0n;
  }
}

function renderDynamicTypeSelector() {
  const selector = document.getElementById("dynamicTypeSelector");
  const issueSelect = document.getElementById("dynamicIssueType");
  if (selector) {
    const current = selector.value;
    selector.innerHTML = '<option value="">Novo certificado</option>';
    dynamicState.items.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name} (#${item.id})`;
      selector.appendChild(opt);
    });
    selector.value = current && dynamicState.map.has(Number(current)) ? current : "";
  }
  if (issueSelect) {
    const currentIssue = issueSelect.value;
    issueSelect.innerHTML = "";
    dynamicState.items.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name} (#${item.id})`;
      issueSelect.appendChild(opt);
    });
    if (issueSelect.options.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhum certificado cadastrado";
      issueSelect.appendChild(opt);
    }
    issueSelect.value = currentIssue && dynamicState.map.has(Number(currentIssue)) ? currentIssue : issueSelect.options[0]?.value || "";
  }
  updateDynamicIssueHint();
}

function renderDynamicTypeList() {
  const container = document.getElementById("dynamicTypesList");
  if (!container) return;
  if (dynamicState.items.length === 0) {
    container.innerHTML = '<p class="muted">Nenhum certificado dinâmico encontrado.</p>';
    return;
  }
  container.innerHTML = "";
  dynamicState.items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "dynamic-type-card";
    const prereqText = item.prerequisiteTypeIds.length
      ? item.prerequisiteTypeIds.map((id) => `#${id}`).join(", ")
      : "—";
    const sheikhCount = item.authorizedSheikhs.length;
    const visibilityLabel = item.isPublic ? "🌐 Público" : "🔒 Privado";
    card.innerHTML = `
      <h4>${escapeHtml(item.name)} <small style="font-weight:400;color:var(--text-secondary);">#${item.id}</small></h4>
      <p class="muted" style="margin-bottom:0.4rem;">${escapeHtml(item.description || "Sem descrição")}</p>
      <div class="dynamic-type-meta">
        <span>${visibilityLabel}</span>
        <span>🎯 ${DYNAMIC_AUDIENCE_LABELS[item.audienceRule] || "Regra indefinida"}</span>
        <span>🏷️ ${DYNAMIC_CATEGORY_LABELS[item.category] || "Categoria"}</span>
        <span>👳 ${sheikhCount} sheiks</span>
        <span>🧾 Pré-req: ${prereqText}</span>
        <span>💰 Taxa: ${weiToGwei(item.publicationFee)} Gwei</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderDynamicPrereqLists() {
  const availableSelect = document.getElementById("dynamicPrereqAvailable");
  const selectedSelect = document.getElementById("dynamicPrereqSelected");
  if (!availableSelect || !selectedSelect) return;
  const editingId = dynamicState.form.editingTypeId;
  const selectedIds = dynamicState.form.selectedPrereqs;
  const availableItems = dynamicState.items.filter(
    (item) => item.id !== editingId && !selectedIds.includes(item.id)
  );
  populateDynamicSelect(
    availableSelect,
    availableItems,
    dynamicFilters.prereqAvailable,
    (item) => `${item.name} (#${item.id})`
  );
  const selectedItems = selectedIds
    .map((id) => dynamicState.map.get(id))
    .filter(Boolean);
  populateDynamicSelect(
    selectedSelect,
    selectedItems,
    dynamicFilters.prereqSelected,
    (item) => `${item.name} (#${item.id})`
  );
}

function renderDynamicSheikhLists() {
  const availableSelect = document.getElementById("dynamicSheikhAvailable");
  const selectedSelect = document.getElementById("dynamicSheikhSelected");
  if (!availableSelect || !selectedSelect) return;
  const selectedSheikhs = dynamicState.form.selectedSheikhs.map((addr) => addr.toLowerCase());
  const availableSheikhs = sheikhDirectory.filter(
    (entry) => !selectedSheikhs.includes(entry.address.toLowerCase())
  );
  populateDynamicSelect(
    availableSelect,
    availableSheikhs,
    dynamicFilters.sheikhAvailable,
    (entry) => `${entry.did || shortAddr(entry.address)} — ${shortAddr(entry.address)}`,
    (entry) => entry.address
  );
  const selectedEntries = dynamicState.form.selectedSheikhs
    .map((addr) => getCachedSheikhIdentity(addr) || { address: addr, did: null })
    .map((entry) => ({ ...entry, address: entry.address }));
  populateDynamicSelect(
    selectedSelect,
    selectedEntries,
    dynamicFilters.sheikhSelected,
    (entry) => `${entry.did || shortAddr(entry.address)} — ${shortAddr(entry.address)}`,
    (entry) => entry.address
  );
}

function populateDynamicSelect(selectEl, items, filterValue, labelFn, valueFn = (item) => item.id) {
  const filter = (filterValue || "").trim().toLowerCase();
  selectEl.innerHTML = "";
  items
    .filter((item) => {
      if (!filter) return true;
      const label = labelFn(item).toLowerCase();
      return label.includes(filter);
    })
    .forEach((item) => {
      const opt = document.createElement("option");
      opt.value = valueFn(item);
      opt.textContent = labelFn(item);
      selectEl.appendChild(opt);
    });
}

function resetDynamicFormFields() {
  dynamicState.form.editingTypeId = null;
  dynamicState.form.selectedPrereqs = [];
  dynamicState.form.selectedSheikhs = [];
  const form = document.getElementById("formDynamicCreate");
  if (form) {
    form.reset();
  }
  if (isSheik && currentAccount && !dynamicState.form.selectedSheikhs.includes(currentAccount)) {
    dynamicState.form.selectedSheikhs.push(currentAccount);
  }
  const selector = document.getElementById("dynamicTypeSelector");
  if (selector) {
    selector.value = "";
  }
  renderDynamicPrereqLists();
  renderDynamicSheikhLists();
}

function setDynamicFormFromType(type) {
  const form = document.getElementById("formDynamicCreate");
  if (!form) return;
  dynamicState.form.editingTypeId = type?.id || null;
  dynamicState.form.selectedPrereqs = [...(type?.prerequisiteTypeIds || [])];
  dynamicState.form.selectedSheikhs = [...(type?.authorizedSheikhs || [])];
  document.getElementById("dynamicName").value = type?.name || "";
  document.getElementById("dynamicDescription").value = type?.description || "";
  document.getElementById("dynamicCategory").value = type ? type.category : "0";
  document.getElementById("dynamicAudience").value = type ? type.audienceRule : "0";
  document.getElementById("dynamicVisibility").value = type ? (type.isPublic ? "public" : "private") : "public";
  document.getElementById("dynamicPayout").value = type?.payoutAddress && type.payoutAddress !== ethers.ZeroAddress ? type.payoutAddress : "";
  document.getElementById("dynamicFee").value = type ? weiToGwei(type.publicationFee) : "";
  renderDynamicPrereqLists();
  renderDynamicSheikhLists();
}

function refreshDynamicPrereqOptions() {
  renderDynamicPrereqLists();
}

function refreshDynamicCertificates(showToast = false) {
  if (!contract || !contractAddress) {
    if (showToast) {
      showStatus("⚠️ Conecte a carteira e selecione o contrato antes de carregar os certificados dinâmicos.", "warning");
    }
    return;
  }
  if (!contractCapabilities.dynamicCertificates) {
    if (showToast) {
      showStatus("🚫 Este contrato não possui suporte a certificados dinâmicos.", "warning");
    }
    return;
  }
  (async () => {
    try {
      const rc = Web3Client.getReadContract(CONTRACT_ABI, contractAddress);
      const rawTypes = await rc.listDynamicCertificateTypes();
      dynamicState.items = rawTypes.map(normalizeDynamicTypeEntity).filter((item) => item && item.exists);
      dynamicState.map.clear();
      dynamicState.items.forEach((item) => dynamicState.map.set(item.id, item));
      dynamicState.loaded = true;
      renderDynamicTypeSelector();
      renderDynamicTypeList();
      renderDynamicPrereqLists();
      renderDynamicSheikhLists();
      if (showToast) {
        showStatus("📜 Certificados dinâmicos atualizados!", "success");
      }
    } catch (err) {
      console.error("[refreshDynamicCertificates]", err);
      showStatus(`⚠️ Falha ao carregar certificados dinâmicos: ${err.message || err}`, "error");
    }
  })();
}

function attachDynamicEventListeners() {
  if (!contract || !contractCapabilities.dynamicCertificates) return;
  detachDynamicEventListeners();
  contractEventSource = contract;
  contractEventSource.on("DynamicCertificateIssued", onDynamicCertificateIssued);
  contractEventSource.on("DynamicCredentialPublicationPaid", onDynamicCredentialPublicationPaid);
  contractEventSource.on("DynamicCertificateTypeCreated", onDynamicCertificateTypeCreated);
  contractEventSource.on("DynamicCertificateTypeUpdated", onDynamicCertificateTypeUpdated);
}

function detachDynamicEventListeners() {
  if (!contractEventSource) return;
  try {
    contractEventSource.removeAllListeners?.("DynamicCertificateIssued");
    contractEventSource.removeAllListeners?.("DynamicCredentialPublicationPaid");
    contractEventSource.removeAllListeners?.("DynamicCertificateTypeCreated");
    contractEventSource.removeAllListeners?.("DynamicCertificateTypeUpdated");
  } catch (err) {
    console.warn("[detachDynamicEventListeners]", err.message);
  }
  contractEventSource = null;
}

function compileDynamicAlertMessage({ title, body, type = "info" }) {
  const emoji = { success: "✅", warning: "⚠️", error: "⛔", info: "ℹ️" }[type] || "ℹ️";
  return `${emoji} ${title} — ${body}`;
}

function onDynamicCertificateIssued(credentialId, typeId, subject, issuer, emojiLog, event) {
  const args = event?.args || {};
  const cred = Number(args[0] ?? credentialId);
  const typ = Number(args[1] ?? typeId);
  const subj = args[2] || subject;
  const author = args[3] || issuer;
  const logMsg = args[4] || emojiLog || "🌙 Certificado emitido";
  const body = `Tipo #${typ}, credencial #${cred}, sujeito ${shortAddr(subj)}, emissor ${shortAddr(author)}.`;
  showStatus(compileDynamicAlertMessage({ title: logMsg, body, type: "success" }), "success", 8000);
  if (dynamicState.loaded) {
    updateDynamicIssueHint();
  }
}

function onDynamicCredentialPublicationPaid(credentialId, payer, amount, payout, emojiLog, event) {
  const args = event?.args || {};
  const cred = Number(args[0] ?? credentialId);
  const pay = args[1] || payer;
  const amt = args[2] || amount;
  const dest = args[3] || payout;
  const logMsg = args[4] || emojiLog || "💎 Publicação paga";
  const body = `Credencial #${cred} publicada por ${shortAddr(pay)} · ${weiToGwei(amt)} Gwei enviados a ${shortAddr(dest)}.`;
  showStatus(compileDynamicAlertMessage({ title: logMsg, body, type: "success" }), "success", 8000);
  if (dynamicState.lastStatus && dynamicState.lastStatus.credentialId === cred) {
    dynamicState.lastStatus = {
      ...dynamicState.lastStatus,
      published: true,
      paidAmount: amt,
      payoutAddress: dest
    };
    renderDynamicPublishInfo();
  }
}

function onDynamicCertificateTypeCreated(typeId, slug, createdBy, name, emojiLog, event) {
  const args = event?.args || {};
  const id = Number(args[0] ?? typeId);
  const author = args[2] || createdBy;
  const label = args[3] || name;
  const logMsg = args[4] || emojiLog || "🎖️ Novo certificado dinâmico";
  const body = `Tipo #${id} (${label}) criado por ${shortAddr(author)}.`;
  showStatus(compileDynamicAlertMessage({ title: logMsg, body, type: "info" }), "info", 6000);
  refreshDynamicCertificates();
}

function onDynamicCertificateTypeUpdated(typeId, slug, updatedBy, name, emojiLog, event) {
  const args = event?.args || {};
  const id = Number(args[0] ?? typeId);
  const author = args[2] || updatedBy;
  const label = args[3] || name;
  const logMsg = args[4] || emojiLog || "🛠️ Certificado dinâmico atualizado";
  const body = `Tipo #${id} (${label}) atualizado por ${shortAddr(author)}.`;
  showStatus(compileDynamicAlertMessage({ title: logMsg, body, type: "info" }), "info", 6000);
  refreshDynamicCertificates();
}

function updateDynamicIssueHint() {
  const hintEl = document.getElementById("dynamicIssueHint");
  if (!hintEl) return;
  const select = document.getElementById("dynamicIssueType");
  const selected = select?.value ? dynamicState.map.get(Number(select.value)) : null;
  if (!selected) {
    hintEl.textContent = "Selecione um certificado dinâmico para ver as regras de emissão.";
    return;
  }
  const parts = [];
  parts.push(selected.isPublic ? "🌐 Certificado público" : "🔒 Certificado privado");
  parts.push(`🎯 Público: ${DYNAMIC_AUDIENCE_LABELS[selected.audienceRule] || "-"}`);
  parts.push(`🧾 Pré-req: ${selected.prerequisiteTypeIds.length ? selected.prerequisiteTypeIds.map((id) => `#${id}`).join(", ") : "Nenhum"}`);
  parts.push(`💰 Taxa publicação: ${weiToGwei(selected.publicationFee)} Gwei`);
  hintEl.textContent = parts.join(" · ");
}

function handleDynamicTypeSelectorChange() {
  const selector = document.getElementById("dynamicTypeSelector");
  if (!selector) return;
  const selectedId = selector.value ? Number(selector.value) : null;
  if (!selectedId) {
    resetDynamicFormFields();
    return;
  }
  const type = dynamicState.map.get(selectedId);
  if (!type) {
    resetDynamicFormFields();
    return;
  }
  setDynamicFormFromType(type);
}

function handleDynamicFilterInput(event) {
  const { id, value } = event.target;
  switch (id) {
    case "dynamicPrereqFilter":
      dynamicFilters.prereqAvailable = value;
      renderDynamicPrereqLists();
      break;
    case "dynamicPrereqSelectedFilter":
      dynamicFilters.prereqSelected = value;
      renderDynamicPrereqLists();
      break;
    case "dynamicSheikhAvailableFilter":
      dynamicFilters.sheikhAvailable = value;
      renderDynamicSheikhLists();
      break;
    case "dynamicSheikhSelectedFilter":
      dynamicFilters.sheikhSelected = value;
      renderDynamicSheikhLists();
      break;
    default:
      break;
  }
}

function moveSelectedOptions(sourceId, targetArray, transformer = (value) => value) {
  const select = document.getElementById(sourceId);
  if (!select) return;
  const values = Array.from(select.selectedOptions).map((opt) => transformer(opt.value));
  values.forEach((val) => {
    if (val != null && !targetArray.includes(val)) {
      targetArray.push(val);
    }
  });
}

function removeSelectedOptions(selectId, targetArray, comparer = (value) => value) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const values = Array.from(select.selectedOptions).map((opt) => comparer(opt.value.toLowerCase()));
  for (const val of values) {
    const idx = targetArray.findIndex((item) => comparer(String(item).toLowerCase()) === val);
    if (idx >= 0) {
      targetArray.splice(idx, 1);
    }
  }
}

function handleAddPrereq() {
  moveSelectedOptions("dynamicPrereqAvailable", dynamicState.form.selectedPrereqs, (value) => Number(value));
  renderDynamicPrereqLists();
}

function handleRemovePrereq() {
  removeSelectedOptions("dynamicPrereqSelected", dynamicState.form.selectedPrereqs, (value) => Number(value));
  renderDynamicPrereqLists();
}

function handleAddSheikh() {
  moveSelectedOptions("dynamicSheikhAvailable", dynamicState.form.selectedSheikhs);
  renderDynamicSheikhLists();
}

function handleRemoveSheikh() {
  removeSelectedOptions("dynamicSheikhSelected", dynamicState.form.selectedSheikhs);
  renderDynamicSheikhLists();
}

function validateSheikhAddress(address) {
  try {
    return ethers.getAddress(address);
  } catch (_) {
    return null;
  }
}

async function handleDynamicFormSubmit(event) {
  event.preventDefault();
  if (!contract) {
    showStatus("⚠️ Configure o contrato antes de salvar certificados dinâmicos.", "warning");
    return;
  }
  if (dynamicState.form.selectedSheikhs.length === 0) {
    showStatus("👳 Selecione ao menos um sheik autorizado.", "warning");
    return;
  }
  const payload = collectDynamicFormPayload();
  if (!payload) return;
  const editing = dynamicState.form.editingTypeId;
  const action = editing ? "Atualizar certificado dinâmico" : "Criar certificado dinâmico";
  const method = editing ? "updateDynamicCertificateType" : "createDynamicCertificateType";
  const args = editing ? [editing, payload] : [payload];
  const receipt = await executeWithConfirmation(`🧾 ${action}`, method, args);
  if (receipt) {
    showStatus(editing ? "🛠️ Certificado atualizado com sucesso!" : "🎖️ Certificado criado com sucesso!", "success");
    resetDynamicFormFields();
    refreshDynamicCertificates();
  }
}

function collectDynamicFormPayload() {
  const name = document.getElementById("dynamicName").value.trim();
  const description = document.getElementById("dynamicDescription").value.trim();
  const audienceRule = Number(document.getElementById("dynamicAudience").value);
  const category = Number(document.getElementById("dynamicCategory").value);
  const visibilityValue = document.getElementById("dynamicVisibility").value;
  const payoutRaw = document.getElementById("dynamicPayout").value.trim();
  const feeInput = document.getElementById("dynamicFee").value.trim();
  const payoutAddress = payoutRaw ? validateSheikhAddress(payoutRaw) : ethers.ZeroAddress;
  if (payoutRaw && !payoutAddress) {
    showStatus("⚠️ Conta para recebimento inválida.", "error");
    return null;
  }
  const publicationFee = gweiToWei(feeInput || "0");
  const uniqueSheikhs = Array.from(new Set(dynamicState.form.selectedSheikhs.map(validateSheikhAddress))).filter(Boolean);
  if (uniqueSheikhs.length === 0) {
    showStatus("👳 Nenhum sheik válido informado.", "error");
    return null;
  }
  const payload = {
    name,
    description,
    audienceRule,
    prerequisiteTypeIds: dynamicState.form.selectedPrereqs,
    category,
    isPublic: visibilityValue !== "private",
    payoutAddress,
    publicationFee,
    authorizedSheikhs: uniqueSheikhs
  };
  return payload;
}

function handleDynamicFormReset(event) {
  event?.preventDefault();
  resetDynamicFormFields();
}

async function handleDynamicIssue(event) {
  event.preventDefault();
  if (!contract) {
    showStatus("⚠️ Configure o contrato antes de emitir certificados dinâmicos.", "warning");
    return;
  }
  const typeSelect = document.getElementById("dynamicIssueType");
  const typeId = typeSelect?.value ? Number(typeSelect.value) : null;
  if (!typeId) {
    showStatus("📌 Escolha um certificado dinâmico para emitir.", "warning");
    return;
  }
  const subjectInput = document.getElementById("dynamicIssueSubject");
  const subject = subjectInput.value.trim();
  if (!ethers.isAddress(subject)) {
    showStatus("⚠️ Endereço do destinatário inválido.", "error");
    return;
  }
  const { claimHash, uri } = buildDynamicClaimPayload();
  const notes = document.getElementById("dynamicIssueNotes").value.trim();
  const receipt = await executeWithConfirmation(
    "🌙 Emitir certificado dinâmico",
    "issueDynamicCertificate",
    [typeId, subject, claimHash, uri || notes || ""]
  );
  if (receipt) {
    showStatus("🌙 Certificado dinâmico emitido com sucesso!", "success");
    document.getElementById("formDynamicIssue").reset();
    resetDynamicIssueContext();
    updateDynamicIssueHint();
  }
}

function buildDynamicClaimPayload() {
  const jsonTextarea = document.getElementById("dynamicIssueJSON");
  const uriInput = document.getElementById("dynamicIssueUri");
  const rawJson = jsonTextarea?.value?.trim();
  if (rawJson) {
    try {
      const parsed = parseDynamicIssueJson(rawJson);
      hydrateDynamicIssueFormFromJson(parsed);
      const canonical = canonicalStringify(parsed);
      dynamicIssueContext.canonicalPayload = canonical;
      const uri = uriInput?.value?.trim() || dynamicIssueContext.derivedUri || "";
      return { claimHash: hashKeccak(canonical), uri };
    } catch (err) {
      console.warn("[buildDynamicClaimPayload] JSON inválido", err.message);
    }
  }
  const uri = uriInput?.value?.trim() || "";
  const notes = document.getElementById("dynamicIssueNotes").value.trim();
  const fallbackPayload = notes || `dynamic:${Date.now()}:${Math.random()}`;
  return { claimHash: hashKeccak(fallbackPayload), uri };
}

async function checkDynamicCredentialStatus(event) {
  event?.preventDefault();
  if (!contract) {
    showStatus("⚠️ Configure o contrato para consultar o status.", "warning");
    return;
  }
  const credIdRaw = document.getElementById("dynamicPublishCredential").value.trim();
  if (!credIdRaw) {
    showStatus("🧾 Informe o ID da credencial.", "warning");
    return;
  }
  try {
    const rc = Web3Client.getReadContract(CONTRACT_ABI, contractAddress);
    const status = await rc.getDynamicCredentialStatus(credIdRaw);
    dynamicState.lastStatus = {
      credentialId: Number(credIdRaw),
      typeId: Number(status.typeId),
      published: status.published,
      publicationFee: status.publicationFee,
      payoutAddress: status.payoutAddress,
      paidAmount: status.paidAmount
    };
    renderDynamicPublishInfo();
    showStatus("ℹ️ Status da credencial atualizado!", "info", 4000);
  } catch (err) {
    console.warn("[checkDynamicCredentialStatus]", err);
    showStatus(`⚠️ Não foi possível consultar o status: ${err.message || err}`, "error");
  }
}

function renderDynamicPublishInfo() {
  const info = document.getElementById("dynamicPublishInfo");
  if (!info) return;
  const status = dynamicState.lastStatus;
  if (!status) {
    info.textContent = "Informe o ID acima para consultar a taxa necessária.";
    info.classList.add("muted");
    return;
  }
  info.classList.remove("muted");
  if (status.published) {
    info.textContent = `✅ Certificado #${status.credentialId} já está publicado. Valor pago: ${weiToGwei(status.paidAmount)} Gwei.`;
  } else {
    info.textContent = `💳 Certificado #${status.credentialId} exige ${weiToGwei(status.publicationFee)} Gwei para publicação. Destino: ${shortAddr(status.payoutAddress)}.`;
  }
}

async function handleDynamicPublish(event) {
  event.preventDefault();
  if (!contract) {
    showStatus("⚠️ Configure o contrato antes de pagar a publicação.", "warning");
    return;
  }
  const credIdRaw = document.getElementById("dynamicPublishCredential").value.trim();
  if (!credIdRaw) {
    showStatus("🧾 Informe o ID da credencial.", "warning");
    return;
  }
  if (!dynamicState.lastStatus || dynamicState.lastStatus.credentialId !== Number(credIdRaw)) {
    await checkDynamicCredentialStatus();
  }
  const status = dynamicState.lastStatus;
  if (!status || status.credentialId !== Number(credIdRaw)) {
    return;
  }
  if (status.published) {
    showStatus("✅ Esta credencial já está publicada.", "info");
    return;
  }
  if (!status.publicationFee || status.publicationFee === 0n) {
    showStatus("⚠️ Nenhuma taxa configurada para publicação.", "warning");
    return;
  }
  const receipt = await executeWithConfirmation(
    "💎 Publicar certificado dinâmico",
    "payDynamicCredentialPublication",
    [status.credentialId],
    { value: status.publicationFee }
  );
  if (receipt) {
    showStatus("💎 Publicação paga com sucesso!", "success");
    dynamicState.lastStatus = { ...status, published: true, paidAmount: status.publicationFee };
    renderDynamicPublishInfo();
  }
}

function getCachedSheikhIdentity(address) {
  if (!address) return null;
  let checksum;
  try {
    checksum = ethers.getAddress(address);
  } catch (_) {
    return null;
  }
  return sheikhDirectoryIndex.get(checksum.toLowerCase()) || null;
}

async function ensureSheikhIdentity(address, rc) {
  if (!address) return null;
  const cached = getCachedSheikhIdentity(address);
  if (cached && cached.did) {
    return cached;
  }
  if (!rc) {
    return cached;
  }
  try {
    const did = await rc.getDID(address);
    const entry = rememberSheikhIdentity(address, { did });
    console.log(`🕌 [ensureSheikhIdentity] DID registrado para ${shortAddr(entry.address)} → ${did}`);
    return entry;
  } catch (err) {
    console.warn(`⚠️ [ensureSheikhIdentity] Falha ao obter DID do emissor ${address}:`, err.message);
    return cached || rememberSheikhIdentity(address, {}, { silent: true }) || null;
  }
}

function resolveSheikhDirectoryEntry(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (sheikhDidIndex.has(lower)) {
    return sheikhDidIndex.get(lower);
  }
  const cached = getCachedSheikhIdentity(trimmed);
  if (cached) return cached;
  const candidate = extractAddressCandidate(trimmed);
  if (candidate) {
    try {
      const addr = ethers.getAddress(candidate);
      return rememberSheikhIdentity(addr);
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

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value && typeof value === "object") {
    const sorted = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        sorted[key] = canonicalizeJson(value[key]);
      });
    return sorted;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalizeJson(value));
}

function formatSheikhIssuerHtml(identity, address, { highlight = false } = {}) {
  const badge = highlight ? "🕌 " : "";
  if (!address) {
    return `${badge}—`;
  }
  let checksum = address;
  try {
    checksum = ethers.getAddress(address);
  } catch (_) {}
  const prettyAddr = shortAddr(checksum);
  if (!identity) {
    return `${badge}<span title="${escapeHtml(checksum)}">${escapeHtml(prettyAddr)}</span>`;
  }
  const mainLabel = identity.did ? escapeHtml(identity.did) : escapeHtml(prettyAddr);
  const addrTag = `<span class="text-mono" title="${escapeHtml(checksum)}">${escapeHtml(prettyAddr)}</span>`;
  return `${badge}<span title="${escapeHtml(identity.did || checksum)}">${mainLabel}</span>${identity.did ? ` ${addrTag}` : ""}`;
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
  const tabDynamic  = document.getElementById("tabDynamicButton");
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
    if (tabDynamic) {
      const canManageDynamic = isSheik || isSuperAdmin;
      tabDynamic.classList.toggle("hidden", !canManageDynamic);
      tabDynamic.disabled = !canManageDynamic;
      tabDynamic.classList.toggle("tab-disabled", !canManageDynamic);
      if (!canManageDynamic && tabDynamic.classList.contains("active")) {
        switchTab("tabDashboard");
      }
      if (canManageDynamic && !dynamicState.loaded) {
        refreshDynamicCertificates();
      }
    }

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
  detachDynamicEventListeners();
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

    detachDynamicEventListeners();
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
    attachDynamicEventListeners();

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
async function executeWithConfirmation(actionName, methodName, args = [], overrides = null) {
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
    const txOverrides = {
      gasLimit: estimation.gasLimit,
      gasPrice: estimation.gasPrice,
      type: 0,
      ...(overrides || {})
    };
    tx = await contract[methodName](...args, txOverrides);
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
  if (tabId === "tabDynamic") {
    if (!isDynamicTabVisible()) {
      showStatus("🚫 Apenas admins ou sheiks ativos acessam esta aba.", "warning");
      switchTab("tabDashboard");
      return;
    }
    if (!dynamicState.loaded) {
      refreshDynamicCertificates();
    } else {
      renderDynamicTypeList();
      renderDynamicPrereqLists();
      renderDynamicSheikhLists();
    }
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
        const credType = Number(c[1]);
        const issuerAddress = c[2];
        const highlightIssuer = credType !== 0;
        let issuerDisplayHtml = "—";
        const isContractIssuer = issuerAddress && contractAddress && issuerAddress.toLowerCase() === contractAddress.toLowerCase();
        if (isContractIssuer) {
          issuerDisplayHtml = "📜 Contrato (auto)";
        } else if (issuerAddress && highlightIssuer) {
          const issuerIdentity = await ensureSheikhIdentity(issuerAddress, rcRead);
          issuerDisplayHtml = formatSheikhIssuerHtml(issuerIdentity, issuerAddress, { highlight: true });
        } else {
          issuerDisplayHtml = formatSheikhIssuerHtml(null, issuerAddress, { highlight: false });
        }

        div.innerHTML = `
          <div class="cred-header">
            <span class="badge ${badgeCls}">${typeName}</span>
            ${c[7] ? '<span class="badge badge-revoked">REVOGADA</span>' : ""}
            <span style="font-size:0.8rem;color:var(--text-secondary);">#${c[0].toString()}</span>
          </div>
          <div class="cred-detail">
            <strong>Emissor:</strong> ${issuerDisplayHtml}<br/>
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
      replaceSheikhDirectory([]);
      return;
    }

    const directoryEntries = [];
    for (let i = 0; i < sheikhs.length; i++) {
      const addr = sheikhs[i];
      let didDisplay = "—";
      let didValue = null;
      try {
        const fetchedDid = await rcSheikhs.getDID(addr);
        didDisplay = fetchedDid;
        didValue = fetchedDid;
      } catch (_) {
        didDisplay = "—";
      }
      directoryEntries.push({ address: addr, did: didValue });

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td class="text-mono">${addr}</td>
        <td class="text-mono" style="font-size:0.75rem;">${didDisplay}</td>
      `;
      tbody.appendChild(tr);
    }
    replaceSheikhDirectory(directoryEntries);

  } catch (err) {
    showStatus("⚠️ Erro ao listar sheiks: " + (err.reason || err.message), "error");
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

  // ── Locais ──
  document.getElementById("btnRefreshLocations").addEventListener("click", refreshLocations);
  const formLocationCreate = document.getElementById("formLocationCreate");
  if (formLocationCreate) formLocationCreate.addEventListener("submit", handleLocationCreate);
  const formAssignSheikh = document.getElementById("formAssignSheikh");
  if (formAssignSheikh) formAssignSheikh.addEventListener("submit", handleAssignSheikh);

  // ── Admin ──
  const formPromoteSheikh = document.getElementById("formPromoteSheikh");
  if (formPromoteSheikh) formPromoteSheikh.addEventListener("submit", handlePromoteSheikh);
  const formIssueSufi = document.getElementById("formIssueSufi");
  if (formIssueSufi) formIssueSufi.addEventListener("submit", handleIssueSufi);
  const formTransferSheikh = document.getElementById("formTransferSheikh");
  if (formTransferSheikh) formTransferSheikh.addEventListener("submit", handleTransferSheikh);
  const formRemoveSheikhFromLocation = document.getElementById("formRemoveSheikhFromLocation");
  if (formRemoveSheikhFromLocation) formRemoveSheikhFromLocation.addEventListener("submit", handleRemoveSheikhFromLocation);

  // ── Doações ──
  document.getElementById("btnRefreshDonations").addEventListener("click", refreshDonations);
  const formDonate = document.getElementById("formDonate");
  if (formDonate) formDonate.addEventListener("submit", handleDonate);

  // ── UI de permissão ──
  updatePermissionUI();

  // ── Popular ordens Sufis ──
  populateSufiOrders();

  // ── Certificados dinâmicos ──
  const dynamicTypeSelector = document.getElementById("dynamicTypeSelector");
  if (dynamicTypeSelector) {
    dynamicTypeSelector.addEventListener("change", handleDynamicTypeSelectorChange);
  }
  [
    "dynamicPrereqFilter",
    "dynamicPrereqSelectedFilter",
    "dynamicSheikhAvailableFilter",
    "dynamicSheikhSelectedFilter"
  ].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.addEventListener("input", handleDynamicFilterInput);
  });
  const btnAddPrereq = document.getElementById("btnAddPrereq");
  const btnRemovePrereq = document.getElementById("btnRemovePrereq");
  const btnAddSheikh = document.getElementById("btnAddSheikh");
  const btnRemoveSheikh = document.getElementById("btnRemoveSheikh");
  if (btnAddPrereq) btnAddPrereq.addEventListener("click", handleAddPrereq);
  if (btnRemovePrereq) btnRemovePrereq.addEventListener("click", handleRemovePrereq);
  if (btnAddSheikh) btnAddSheikh.addEventListener("click", handleAddSheikh);
  if (btnRemoveSheikh) btnRemoveSheikh.addEventListener("click", handleRemoveSheikh);
  const formDynamicCreate = document.getElementById("formDynamicCreate");
  if (formDynamicCreate) {
    formDynamicCreate.addEventListener("submit", handleDynamicFormSubmit);
  }
  const btnDynamicReset = document.getElementById("btnDynamicReset");
  if (btnDynamicReset) {
    btnDynamicReset.addEventListener("click", handleDynamicFormReset);
  }
  const btnDynamicReload = document.getElementById("btnDynamicReload");
  if (btnDynamicReload) {
    btnDynamicReload.addEventListener("click", () => refreshDynamicCertificates(true));
  }
  const formDynamicIssue = document.getElementById("formDynamicIssue");
  if (formDynamicIssue) {
    formDynamicIssue.addEventListener("submit", handleDynamicIssue);
  }
  const dynamicIssueType = document.getElementById("dynamicIssueType");
  if (dynamicIssueType) {
    dynamicIssueType.addEventListener("change", updateDynamicIssueHint);
  }
  const dynamicIssueJsonField = document.getElementById("dynamicIssueJSON");
  if (dynamicIssueJsonField) {
    ["blur", "change"].forEach((evt) => dynamicIssueJsonField.addEventListener(evt, handleDynamicIssueJsonChange));
  }
  const dynamicIssueJsonFile = document.getElementById("dynamicIssueJsonFile");
  if (dynamicIssueJsonFile) {
    dynamicIssueJsonFile.addEventListener("change", handleDynamicIssueFileChange);
  }
  const btnDynamicCheckStatus = document.getElementById("btnDynamicCheckStatus");
  if (btnDynamicCheckStatus) {
    btnDynamicCheckStatus.addEventListener("click", checkDynamicCredentialStatus);
  }
  const formDynamicPublish = document.getElementById("formDynamicPublish");
  if (formDynamicPublish) {
    formDynamicPublish.addEventListener("submit", handleDynamicPublish);
  }

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
