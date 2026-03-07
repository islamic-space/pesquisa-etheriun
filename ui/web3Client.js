/**
 * @file web3Client.js
 * @description Módulo de integração com MetaMask (EIP-1193) usando ethers.js v6.
 *              Fornece funções para conectar carteira, obter signer, saldo,
 *              estimar custos de transação e instanciar contratos.
 *              NÃO persiste chaves privadas — usa apenas contas importadas no MetaMask.
 */

const Web3Client = (() => {

  /** @type {ethers.BrowserProvider|null} */
  let _provider = null;

  /** @type {ethers.JsonRpcSigner|null} */
  let _signer = null;

  /** @type {string|null} */
  let _address = null;

  /** @type {string|null} */
  let _chainId = null;

  // ─────────────────────────────────────────────
  //  Provider / Detecção
  // ─────────────────────────────────────────────

  /**
   * Verifica se o MetaMask (window.ethereum) está disponível.
   * @returns {boolean}
   */
  function isMetaMaskAvailable() {
    return typeof window.ethereum !== "undefined";
  }

  /**
   * Retorna o BrowserProvider do MetaMask. Cria um novo se necessário.
   * @returns {ethers.BrowserProvider}
   * @throws Se MetaMask não estiver instalado.
   */
  function getProviderFromMetaMask() {
    if (!isMetaMaskAvailable()) {
      throw new Error("MetaMask não encontrado. Instale a extensão para continuar.");
    }
    if (!_provider) {
      _provider = new ethers.BrowserProvider(window.ethereum);
    }
    return _provider;
  }

  /**
   * Cria uma instância de contrato read-only via BrowserProvider (MetaMask).
   * Todas as leituras (view/pure) passam pelo MetaMask como proxy RPC.
   * @param {Array|string} abi
   * @param {string} address
   * @returns {ethers.Contract}
   */
  function getReadContract(abi, address) {
    // Fresh BrowserProvider every call — avoids MetaMask eth_call cache
    const fresh = new ethers.BrowserProvider(window.ethereum);
    return new ethers.Contract(address, abi, fresh);
  }

  // ─────────────────────────────────────────────
  //  Conexão
  // ─────────────────────────────────────────────

  /**
   * Solicita conexão ao MetaMask (eth_requestAccounts).
   * Retorna endereço e chainId da conta selecionada.
   * @returns {Promise<{address: string, chainId: string}>}
   */
  async function connectWallet() {
    if (!isMetaMaskAvailable()) {
      throw new Error("MetaMask não encontrado. Instale a extensão para continuar.");
    }

    // Usa wallet_requestPermissions para forçar o popup de seleção de conta
    // (eth_requestAccounts retorna a conta em cache sem mostrar o picker)
    await window.ethereum.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }]
    });

    const accounts = await window.ethereum.request({ method: "eth_accounts" });

    if (!accounts || accounts.length === 0) {
      throw new Error("Nenhuma conta autorizada pelo MetaMask.");
    }

    // Recria o provider APÓS a autorização para garantir estado limpo
    _provider = new ethers.BrowserProvider(window.ethereum);

    _signer = await _provider.getSigner();
    _address = await _signer.getAddress();

    const network = await _provider.getNetwork();
    _chainId = network.chainId.toString();

    // Salva último endereço conectado (não é dado sensível)
    try { localStorage.setItem("ip_lastConnectedAddress", _address); } catch (_) {}

    return { address: _address, chainId: _chainId };
  }

  // ─────────────────────────────────────────────
  //  Saldo
  // ─────────────────────────────────────────────

  /**
   * Retorna o saldo em ETH de um endereço.
   * @param {string} [address] - Se omitido, usa o endereço conectado.
   * @returns {Promise<string>} Saldo formatado em ETH (ex: "99.8712")
   */
  async function getBalanceETH(address) {
    const addr = address || _address;
    if (!addr) throw new Error("Nenhum endereço conectado.");

    // Usa MetaMask como proxy RPC
    const hexBalance = await window.ethereum.request({
      method: "eth_getBalance",
      params: [addr, "latest"]
    });
    return ethers.formatEther(BigInt(hexBalance));
  }

  // ─────────────────────────────────────────────
  //  Signer & Contract
  // ─────────────────────────────────────────────

  /**
   * Retorna o signer atual do MetaMask.
   * @returns {ethers.JsonRpcSigner}
   */
  function getSigner() {
    if (!_signer) throw new Error("Carteira não conectada.");
    return _signer;
  }

  /**
   * Retorna o endereço conectado.
   * @returns {string|null}
   */
  function getAddress() {
    return _address;
  }

  /**
   * Retorna o chainId atual.
   * @returns {string|null}
   */
  function getChainId() {
    return _chainId;
  }

  /**
   * Cria uma instância de contrato conectada ao signer do MetaMask.
   * @param {Array|string} abi
   * @param {string} address
   * @returns {ethers.Contract}
   */
  function getContractWithSigner(abi, address) {
    const s = getSigner();
    return new ethers.Contract(address, abi, s);
  }

  /**
   * Atualiza o signer atual para outro endereço autorizado no MetaMask.
   * Não abre popup; requer que o endereço já tenha sido autorizado anteriormente.
   * @param {string} address
   * @returns {Promise<string>} Endereço confirmado pelo signer
   */
  async function switchAccount(address) {
    if (!address) {
      throw new Error("Endereço inválido para troca de conta.");
    }
    if (!isMetaMaskAvailable()) {
      throw new Error("MetaMask não encontrado.");
    }
    if (!_provider) {
      _provider = new ethers.BrowserProvider(window.ethereum);
    }
    _signer = await _provider.getSigner(address);
    _address = await _signer.getAddress();
    return _address;
  }

  // ─────────────────────────────────────────────
  //  Estimativa de custo de transação
  // ─────────────────────────────────────────────

  /**
   * Estima o custo de uma transação populada.
   * Tenta EIP-1559 (maxFeePerGas) primeiro; se não disponível, usa gasPrice legado.
   * @param {ethers.Contract} contractInstance
   * @param {string} methodName
   * @param {Array} args
   * @returns {Promise<{gasLimit: bigint, feeData: ethers.FeeData, estimatedETH: string, populatedTx: object}>}
   */
  async function estimateTxCost(contractInstance, methodName, args = []) {
    const provider = getProviderFromMetaMask();

    // Popula a transação (sem enviá-la)
    const populatedTx = await contractInstance[methodName].populateTransaction(...args);

    // Estima gas (adiciona 50% de margem para segurança)
    const rawGas = await provider.estimateGas({
      ...populatedTx,
      from: _address
    });
    const gasLimit = rawGas * 3n / 2n; // +50%

    // Obtém gasPrice via RPC legado (via MetaMask)
    let gasPrice;
    try {
      const hexPrice = await window.ethereum.request({ method: "eth_gasPrice" });
      gasPrice = BigInt(hexPrice);
    } catch (_) {
      // Fallback: preço padrão (20 gwei)
      gasPrice = ethers.parseUnits("20", "gwei");
    }

    const gasCost = gasLimit * gasPrice;
    const estimatedETH = ethers.formatEther(gasCost);

    return { gasLimit, gasPrice, estimatedETH, populatedTx };
  }

  // ─────────────────────────────────────────────
  //  Eventos MetaMask
  // ─────────────────────────────────────────────

  /**
   * Registra callbacks para mudanças de conta e rede.
   * @param {Function} onAccountsChanged
   * @param {Function} onChainChanged
   */
  function listenMetaMaskEvents(onAccountsChanged, onChainChanged) {
    if (!isMetaMaskAvailable()) return;

    window.ethereum.on("accountsChanged", (accounts) => {
      if (accounts.length === 0) {
        // Desconectou
        _signer = null;
        _address = null;
        _chainId = null;
        _provider = null;
      }
      if (onAccountsChanged) onAccountsChanged(accounts);
    });

    window.ethereum.on("chainChanged", (chainIdHex) => {
      // Reseta provider para pegar nova rede
      _provider = null;
      _signer = null;
      if (onChainChanged) onChainChanged(chainIdHex);
    });
  }

  // ─────────────────────────────────────────────
  //  Tratamento de erros
  // ─────────────────────────────────────────────

  /**
   * Interpreta erros comuns do MetaMask / ethers e retorna mensagem legível.
   * @param {Error} err
   * @returns {string}
   */
  function parseError(err) {
    // EIP-1193: User rejected request
    if (err.code === 4001 || err.code === "ACTION_REJECTED") {
      return "Transação cancelada pelo usuário.";
    }
    // Saldo insuficiente
    if (err.code === -32000 || (err.message && err.message.includes("insufficient funds"))) {
      return "Saldo insuficiente para cobrir o gas desta transação.";
    }
    // Revert do contrato
    if (err.reason) {
      return `Contrato reverteu: ${err.reason}`;
    }
    if (err.data && err.data.message) {
      return `Erro do contrato: ${err.data.message}`;
    }
    return err.message || String(err);
  }

  // ─────────────────────────────────────────────
  //  Reset (para troca de conta/rede)
  // ─────────────────────────────────────────────

  function reset() {
    _provider = null;
    _signer = null;
    _address = null;
    _chainId = null;
  }

  // ── API pública ──
  return {
    isMetaMaskAvailable,
    getProviderFromMetaMask,
    getReadContract,
    connectWallet,
    getBalanceETH,
    getSigner,
    getAddress,
    getChainId,
    getContractWithSigner,
    switchAccount,
    estimateTxCost,
    listenMetaMaskEvents,
    parseError,
    reset
  };

})();
