/**
 * @file app.js
 * @description Interface web para o contrato IslamicPassport.
 *              Usa ethers.js v6 para conectar ao MetaMask e interagir com o contrato.
 *              Dados pessoais são mantidos localmente; apenas hashes vão on-chain.
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

/** @type {ethers.BrowserProvider|null} */
let provider = null;

/** @type {ethers.Signer|null} */
let signer = null;

/** @type {ethers.Contract|null} */
let contract = null;

/** @type {string|null} Endereço conectado */
let currentAccount = null;

/** @type {string|null} ChainId atual */
let currentChainId = null;

/** @type {string|null} Endereço do contrato */
let contractAddress = null;

/**
 * Nomes dos tipos de credencial (espelhando o enum do contrato).
 */
const CRED_TYPE_NAMES = ["INITIAL", "MUSLIM_ATTESTATION", "SHEIK_CERTIFICATE"];
const CRED_BADGE_CLASS = ["badge-initial", "badge-muslim", "badge-sheik"];

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
//  Conexão com MetaMask
// ═══════════════════════════════════════════════════════════

/**
 * Conecta ao MetaMask, obtém signer e chainId.
 */
async function connectWallet() {
  if (typeof window.ethereum === "undefined") {
    showStatus("MetaMask não encontrado. Instale a extensão.", "error");
    return;
  }

  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    currentAccount = await signer.getAddress();
    const network = await provider.getNetwork();
    currentChainId = network.chainId.toString();

    // Atualiza UI
    document.getElementById("walletAddress").textContent = shortAddr(currentAccount);
    document.getElementById("walletChain").textContent = currentChainId;
    document.getElementById("walletInfo").classList.remove("hidden");
    document.getElementById("btnConnect").textContent = shortAddr(currentAccount);

    showStatus(`Conectado: ${shortAddr(currentAccount)} (chain ${currentChainId})`, "success");

    // Se já tem endereço de contrato configurado, reconecta o contrato
    if (contractAddress) {
      attachContract(contractAddress);
    }

    // Tenta carregar endereço salvo
    const saved = localStorage.getItem("ip_contractAddress");
    if (saved && !contractAddress) {
      document.getElementById("inputContractAddr").value = saved;
      attachContract(saved);
    }

  } catch (err) {
    showStatus("Erro ao conectar: " + err.message, "error");
  }
}

/**
 * Instancia o contrato com o signer atual.
 * @param {string} addr
 */
function attachContract(addr) {
  if (!signer) {
    showStatus("Conecte a carteira primeiro.", "warning");
    return;
  }
  try {
    contractAddress = addr;
    contract = new ethers.Contract(addr, CONTRACT_ABI, signer);
    localStorage.setItem("ip_contractAddress", addr);
    showStatus(`Contrato configurado: ${shortAddr(addr)}`, "success");
  } catch (err) {
    showStatus("Endereço de contrato inválido: " + err.message, "error");
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
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.remove("active"));

  document.getElementById(tabId).classList.add("active");
  document.querySelector(`nav.tabs button[data-tab="${tabId}"]`).classList.add("active");

  // Ações ao entrar na aba
  if (tabId === "tabDashboard") refreshDashboard();
  if (tabId === "tabSheikhs") refreshSheikhs();
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

  showStatus("Enviando transação de registro...", "info", 30000);

  try {
    const tx = await contract.registerProfile(hNome, hMuslim, hMosque, uri);
    showStatus("Transação enviada. Aguardando confirmação...", "info", 60000);
    await tx.wait();

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
    switchTab("tabDashboard");

  } catch (err) {
    const reason = err.reason || err.message || String(err);
    showStatus("Erro no registro: " + reason, "error", 8000);
  }
}

// ═══════════════════════════════════════════════════════════
//  Dashboard
// ═══════════════════════════════════════════════════════════

/**
 * Atualiza o painel do usuário logado.
 */
async function refreshDashboard() {
  if (!contract || !currentAccount) return;

  const dashContent = document.getElementById("dashContent");
  const dashNot = document.getElementById("dashNotRegistered");
  const regAlert = document.getElementById("alreadyRegistered");

  try {
    const profile = await contract.getProfile(currentAccount);
    const exists = profile[5]; // bool exists

    if (!exists) {
      dashContent.classList.add("hidden");
      dashNot.classList.remove("hidden");
      regAlert.classList.add("hidden");
      return;
    }

    dashNot.classList.add("hidden");
    dashContent.classList.remove("hidden");
    regAlert.classList.remove("hidden"); // mostra aviso na aba registro

    // DID
    const did = await contract.getDID(currentAccount);
    document.getElementById("dashDID").textContent = did;

    // UserId
    document.getElementById("dashUserId").textContent = profile[0].toString();

    // Sheik badge
    const sheik = await contract.isSheikh(currentAccount);
    document.getElementById("dashSheikBadge").classList.toggle("hidden", !sheik);

    // Credenciais
    const credIds = await contract.getCredentialsOf(currentAccount);
    const container = document.getElementById("dashCredentials");
    container.innerHTML = "";

    if (credIds.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Nenhuma credencial encontrada.</p>';
      return;
    }

    for (const cid of credIds) {
      const c = await contract.getCredential(cid);
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

  } catch (err) {
    showStatus("Erro ao carregar painel: " + (err.reason || err.message), "error");
  }
}

// ═══════════════════════════════════════════════════════════
//  Sheikhs
// ═══════════════════════════════════════════════════════════

/**
 * Carrega e exibe a lista de sheiks.
 */
async function refreshSheikhs() {
  if (!contract) { showStatus("Configure o contrato.", "warning"); return; }

  try {
    const sheikhs = await contract.listSheikhs();
    const tbody = document.getElementById("sheikhTableBody");
    tbody.innerHTML = "";

    if (sheikhs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-secondary);">Nenhum sheik registrado ainda.</td></tr>';
      return;
    }

    for (let i = 0; i < sheikhs.length; i++) {
      const addr = sheikhs[i];
      let did = "";
      try { did = await contract.getDID(addr); } catch (_) { did = "—"; }

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

  showStatus("Enviando atesto...", "info", 30000);

  try {
    const tx = await contract.attestMuslim(subject, claimHash, uri);
    showStatus("Transação enviada. Aguardando confirmação...", "info", 60000);
    await tx.wait();
    showStatus("Atesto emitido com sucesso!", "success");
    document.getElementById("formAttest").reset();
  } catch (err) {
    showStatus("Erro no atesto: " + (err.reason || err.message), "error", 8000);
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

  showStatus("Enviando promoção...", "info", 30000);

  try {
    const tx = await contract.promoteToSheikh(subject, claimHash, uri);
    showStatus("Transação enviada. Aguardando confirmação...", "info", 60000);
    await tx.wait();
    showStatus("Promoção a sheik realizada com sucesso!", "success");
    document.getElementById("formPromote").reset();
  } catch (err) {
    showStatus("Erro na promoção: " + (err.reason || err.message), "error", 8000);
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

  showStatus("Enviando revogação...", "info", 30000);

  try {
    const tx = await contract.revokeCredential(credId);
    showStatus("Transação enviada. Aguardando confirmação...", "info", 60000);
    await tx.wait();
    showStatus(`Credencial #${credId} revogada com sucesso!`, "success");
    document.getElementById("formRevoke").reset();
  } catch (err) {
    showStatus("Erro na revogação: " + (err.reason || err.message), "error", 8000);
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

  // ── Conectar carteira ──
  document.getElementById("btnConnect").addEventListener("click", connectWallet);

  // ── Configurar contrato ──
  document.getElementById("btnSetContract").addEventListener("click", () => {
    const addr = document.getElementById("inputContractAddr").value.trim();
    if (!addr || !ethers.isAddress(addr)) {
      showStatus("Endereço de contrato inválido.", "error");
      return;
    }
    attachContract(addr);
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
  if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged", () => location.reload());
  }

  // ── Restaurar contrato salvo ──
  const savedAddr = localStorage.getItem("ip_contractAddress");
  if (savedAddr) {
    document.getElementById("inputContractAddr").value = savedAddr;
  }
});
