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
  '#formAttest button[type="submit"]',
  '#formPromote button[type="submit"]',
  '#formRevoke button[type="submit"]',
  '#btnExportVC',
  '#btnRefreshSheikhs'
].join(",");

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
  }

  renderContractSelect();

  // Auto-seleciona o próximo contrato disponível
  if (contractList.length > 0 && currentAccount) {
    const next = contractList[0];
    sel.value = next;
    attachContract(next);
  }

  showStatus(`Contrato ${shortAddr(addr)} removido da lista. (${before - contractList.length} removido(s))`, "info", 4000);
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

// ═══════════════════════════════════════════════════════════
//  C) Atesto de muçulmano
// ═══════════════════════════════════════════════════════════

/**
 * Handler do formulário de atesto.
 * @param {Event} e
 */
async function handleAttest(e) {
  e.preventDefault();
  if (!contract) { showStatus("Configure o contrato.", "warning"); return; }
  if (!canAttestMuslim) { showStatus("Apenas sheiks com certificado ativo podem atestar muçulmanos neste contrato.", "warning"); return; }

  const subject = document.getElementById("attestSubject").value.trim();
  const uri = document.getElementById("attestUri").value.trim();

  if (!ethers.isAddress(subject)) {
    showStatus("Endereço inválido.", "error");
    return;
  }

  // Gera VC JSON local para o atesto
  const vc = buildVCJson({
    type: "MuslimAttestation",
    issuer: `did:ethr:${currentChainId}:${currentAccount}`,
    subject: `did:ethr:${currentChainId}:${subject}`,
    claims: { attestedBy: currentAccount, attestationType: "MUSLIM_ATTESTATION" },
    issuedAt: BigInt(Math.floor(Date.now() / 1000))
  });
  const claimHash = vcClaimHash(vc);

  const receipt = await executeWithConfirmation(
    "Atesto de Muçulmano",
    "attestMuslim",
    [subject, claimHash, uri]
  );

  if (receipt) {
    console.log(`[handleAttest] TX hash: ${receipt.hash}`);
    console.log(`[handleAttest] Contrato: ${contractAddress}`);
    console.log(`[handleAttest] Logs no receipt: ${receipt.logs ? receipt.logs.length : 0}`);
    if (receipt.logs && receipt.logs.length > 0) {
      for (let i = 0; i < receipt.logs.length; i++) {
        const log = receipt.logs[i];
        try {
          const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
          if (parsed) {
            console.log(`[handleAttest] Log[${i}] parsed event: ${parsed.name}`, parsed.args);
            if (parsed.name === "CredentialIssued") {
              console.log(`[handleAttest] ✅ CredentialIssued → credentialId: ${parsed.args[0].toString()}, type: ${CRED_TYPE_NAMES[Number(parsed.args[1])] || parsed.args[1]}, issuer: ${parsed.args[2]}, subject: ${parsed.args[3]}`);
            } else if (parsed.name === "AttestedMuslim") {
              console.log(`[handleAttest] ✅ AttestedMuslim → issuer: ${parsed.args[0]}, subject: ${parsed.args[1]}, credentialId: ${parsed.args[2].toString()}`);
            }
          }
        } catch (parseErr) {
          console.warn(`[handleAttest] Log[${i}] parse falhou:`, parseErr.message);
        }
      }
    } else {
      console.warn("[handleAttest] Nenhum log no receipt.", receipt);
    }

    showStatus("Atesto emitido com sucesso!", "success");
    document.getElementById("formAttest").reset();
  }
}

// ═══════════════════════════════════════════════════════════
//  D) Promoção a sheik
// ═══════════════════════════════════════════════════════════

/**
 * Handler do formulário de promoção.
 * @param {Event} e
 */
async function handlePromote(e) {
  e.preventDefault();
  if (!contract) { showStatus("Configure o contrato.", "warning"); return; }
  if (!canPromoteToSheik) { showStatus("Somente sheiks ativos ou o SuperAdmin da V2 podem promover sheiks.", "warning"); return; }

  const subject = document.getElementById("promoteSubject").value.trim();
  const uri = document.getElementById("promoteUri").value.trim();

  if (!ethers.isAddress(subject)) {
    showStatus("Endereço inválido.", "error");
    return;
  }

  // Gera VC JSON local para a promoção
  const vc = buildVCJson({
    type: "SheikhCertificate",
    issuer: `did:ethr:${currentChainId}:${currentAccount}`,
    subject: `did:ethr:${currentChainId}:${subject}`,
    claims: { promotedBy: currentAccount, certificateType: "SHEIK_CERTIFICATE" },
    issuedAt: BigInt(Math.floor(Date.now() / 1000))
  });
  const claimHash = vcClaimHash(vc);

  const receipt = await executeWithConfirmation(
    "Promoção a Sheik",
    "promoteToSheikh",
    [subject, claimHash, uri]
  );

  if (receipt) {
    console.log(`[handlePromote] TX hash: ${receipt.hash}`);
    console.log(`[handlePromote] Contrato: ${contractAddress}`);
    console.log(`[handlePromote] Logs no receipt: ${receipt.logs ? receipt.logs.length : 0}`);
    if (receipt.logs && receipt.logs.length > 0) {
      for (let i = 0; i < receipt.logs.length; i++) {
        const log = receipt.logs[i];
        try {
          const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
          if (parsed) {
            console.log(`[handlePromote] Log[${i}] parsed event: ${parsed.name}`, parsed.args);
            if (parsed.name === "CredentialIssued") {
              console.log(`[handlePromote] ✅ CredentialIssued → credentialId: ${parsed.args[0].toString()}, type: ${CRED_TYPE_NAMES[Number(parsed.args[1])] || parsed.args[1]}, issuer: ${parsed.args[2]}, subject: ${parsed.args[3]}`);
            } else if (parsed.name === "SheikhPromoted") {
              console.log(`[handlePromote] ✅ SheikhPromoted → issuer: ${parsed.args[0]}, subject: ${parsed.args[1]}, credentialId: ${parsed.args[2].toString()}`);
            }
          }
        } catch (parseErr) {
          console.warn(`[handlePromote] Log[${i}] parse falhou:`, parseErr.message);
        }
      }
    } else {
      console.warn("[handlePromote] Nenhum log no receipt.", receipt);
    }

    showStatus("Promoção a sheik realizada com sucesso!", "success");
    document.getElementById("formPromote").reset();
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

  // ── Estado inicial: desabilitar botões on-chain ──
  setOnchainButtonsEnabled(false);
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

  // ── Selecionar contrato do combobox ──
  document.getElementById("selectContract").addEventListener("change", (e) => {
    const addr = e.target.value;
    if (addr) attachContract(addr);
  });

  // ── Selecionar conta do combobox ──
  document.getElementById("selectAccount").addEventListener("change", async (e) => {
    const addr = e.target.value;
    if (!addr) return;
    // Troca a conta ativa — infelizmente MetaMask não permite trocar programaticamente,
    // mas podemos pedir ao usuário que troque no MetaMask.
    // Se a conta selecionada já é a conectada, noop.
    if (addr.toLowerCase() !== currentAccount.toLowerCase()) {
      showStatus("Para trocar de conta, selecione-a diretamente no MetaMask. A página irá recarregar automaticamente.", "warning", 8000);
    }
  });

  // ── Tabs ──
  document.querySelectorAll("nav.tabs button").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // ── Registro ──
  document.getElementById("formRegister").addEventListener("submit", handleRegister);

  // ── Atesto ──
  document.getElementById("formAttest").addEventListener("submit", handleAttest);

  // ── Promoção ──
  document.getElementById("formPromote").addEventListener("submit", handlePromote);

  // ── Revogação ──
  document.getElementById("formRevoke").addEventListener("submit", handleRevoke);

  // ── Solicitar atesto ──
  document.getElementById("formRequest").addEventListener("submit", handleRequest);

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
