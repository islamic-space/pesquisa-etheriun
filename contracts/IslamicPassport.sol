// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IslamicPassport
 * @notice Sistema de identidade descentralizada (SSI) para comunidades islâmicas.
 *         Armazena apenas hashes/commitments on-chain — dados pessoais ficam off-chain.
 *
 * Roles:
 *   - DEFAULT_ADMIN_ROLE  → deployer; pode revogar qualquer credencial.
 *   - SHEIK_ROLE           → pode atestar muçulmanos e promover novos sheiks.
 *
 * Fluxo:
 *   1. Usuário registra perfil (hashes de nome oficial, nome muçulmano e mesquita).
 *   2. Primeiro registro vira SHEIK automaticamente.
 *   3. Sheik atesta um muçulmano  → CredentialType.MUSLIM_ATTESTATION.
 *   4. Sheik promove outro a sheik → CredentialType.SHEIK_CERTIFICATE + SHEIK_ROLE.
 *   5. Issuer ou admin pode revogar credenciais.
 */

import "@openzeppelin/contracts/access/AccessControl.sol";

contract IslamicPassport is AccessControl {

    // ───────────── Roles ─────────────
    bytes32 public constant SHEIK_ROLE = keccak256("SHEIK_ROLE");

    // ───────────── Enums ─────────────
    enum CredentialType {
        INITIAL,                // 0 — certificado de registro
        MUSLIM_ATTESTATION,     // 1 — atesto de muçulmano por sheik
        SHEIK_CERTIFICATE       // 2 — promoção a sheik
    }

    // ───────────── Structs ─────────────

    /// @notice Perfil on-chain: apenas hashes e um ponteiro opcional off-chain.
    struct Profile {
        uint256 userId;
        bytes32 hNomeOficial;
        bytes32 hNomeMuculmano;
        bytes32 hMesquita;
        string  uri;            // ex.: ipfs://... com VC cifrada
        bool    exists;
    }

    /// @notice Credencial verificável (VC) on-chain — somente commitments.
    struct Credential {
        uint256         id;
        CredentialType  credType;
        address         issuer;     // address(0) = contrato (auto-emitida)
        address         subject;
        bytes32         claimHash;
        string          uri;
        uint256         issuedAt;
        bool            revoked;
    }

    // ───────────── State ─────────────

    /// @dev Contador de usuários (userId começa em 1).
    uint256 private _nextUserId = 1;

    /// @dev Contador de credenciais (credentialId começa em 1).
    uint256 private _nextCredentialId = 1;

    /// @dev address → Profile
    mapping(address => Profile) private _profiles;

    /// @dev credentialId → Credential
    mapping(uint256 => Credential) private _credentials;

    /// @dev address → lista de credentialIds emitidas PARA o subject
    mapping(address => uint256[]) private _userCredentials;

    /// @dev Array de sheiks para listagem rápida.
    address[] private _sheikhs;

    /// @dev Controle auxiliar para evitar duplicatas no array de sheiks.
    mapping(address => bool) private _isSheikh;

    /// @dev chainId capturado no deploy para compor o DID.
    uint256 public deployChainId;

    // ───────────── Events ─────────────

    event ProfileRegistered(
        address indexed user,
        uint256 indexed userId,
        bytes32 hNomeOficial,
        bytes32 hNomeMuculmano,
        bytes32 hMesquita,
        string  uri
    );

    event CredentialIssued(
        uint256 indexed credentialId,
        CredentialType  credType,
        address indexed issuer,
        address indexed subject,
        bytes32 claimHash,
        string  uri
    );

    event AttestedMuslim(
        address indexed issuer,
        address indexed subject,
        uint256 indexed credentialId
    );

    event SheikhPromoted(
        address indexed issuer,
        address indexed subject,
        uint256 indexed credentialId
    );

    event CredentialRevoked(
        uint256 indexed credentialId,
        address indexed revokedBy
    );

    // ───────────── Constructor ─────────────

    constructor() {
        // Deployer recebe DEFAULT_ADMIN_ROLE
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        // Captura chainId para gerar DID
        deployChainId = block.chainid;
    }

    // ═══════════════════════════════════════════════════════════════
    //  A) Registro de perfil
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Registra um perfil enviando apenas hashes dos dados pessoais.
     * @param hNomeOficial  keccak256 do nome oficial normalizado.
     * @param hNomeMuculmano keccak256 do nome muçulmano normalizado.
     * @param hMesquita     keccak256 da mesquita normalizada.
     * @param optionalUri   URI off-chain da VC cifrada (pode ser "").
     */
    function registerProfile(
        bytes32 hNomeOficial,
        bytes32 hNomeMuculmano,
        bytes32 hMesquita,
        string calldata optionalUri
    ) external {
        require(!_profiles[msg.sender].exists, "IslamicPassport: perfil ja registrado");

        uint256 userId = _nextUserId++;

        _profiles[msg.sender] = Profile({
            userId: userId,
            hNomeOficial: hNomeOficial,
            hNomeMuculmano: hNomeMuculmano,
            hMesquita: hMesquita,
            uri: optionalUri,
            exists: true
        });

        emit ProfileRegistered(msg.sender, userId, hNomeOficial, hNomeMuculmano, hMesquita, optionalUri);

        // Emissão automática do certificado INITIAL (issuer = address(this))
        _issueCredential(CredentialType.INITIAL, address(this), msg.sender, bytes32(0), "");

        // Primeiro usuário vira sheik automaticamente
        if (userId == 1) {
            _grantRole(SHEIK_ROLE, msg.sender);
            _addSheikh(msg.sender);

            // Emite certificado SHEIK_CERTIFICATE automático
            _issueCredential(CredentialType.SHEIK_CERTIFICATE, address(this), msg.sender, bytes32(0), "");
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  C) Atesto de muçulmano por sheik
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Sheik atesta que um subject é muçulmano.
     * @param subject   Endereço do muçulmano atestado.
     * @param claimHash Hash da VC gerada off-chain.
     * @param optionalUri URI off-chain da VC.
     */
    function attestMuslim(
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external onlyRole(SHEIK_ROLE) {
        require(_profiles[subject].exists, "IslamicPassport: subject nao registrado");

        uint256 credId = _issueCredential(
            CredentialType.MUSLIM_ATTESTATION,
            msg.sender,
            subject,
            claimHash,
            optionalUri
        );

        emit AttestedMuslim(msg.sender, subject, credId);
    }

    // ═══════════════════════════════════════════════════════════════
    //  D) Promoção a sheik
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Sheik promove outro usuário a sheik.
     * @param subject   Endereço do novo sheik.
     * @param claimHash Hash da VC gerada off-chain.
     * @param optionalUri URI off-chain da VC.
     */
    function promoteToSheikh(
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external onlyRole(SHEIK_ROLE) {
        require(_profiles[subject].exists, "IslamicPassport: subject nao registrado");
        require(!_isSheikh[subject], "IslamicPassport: subject ja e sheik");

        _grantRole(SHEIK_ROLE, subject);
        _addSheikh(subject);

        uint256 credId = _issueCredential(
            CredentialType.SHEIK_CERTIFICATE,
            msg.sender,
            subject,
            claimHash,
            optionalUri
        );

        emit SheikhPromoted(msg.sender, subject, credId);
    }

    // ═══════════════════════════════════════════════════════════════
    //  E) Revogação
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Revoga uma credencial. Apenas o issuer ou um ADMIN pode revogar.
     * @param credentialId ID da credencial a revogar.
     */
    function revokeCredential(uint256 credentialId) external {
        Credential storage cred = _credentials[credentialId];
        require(cred.id != 0, "IslamicPassport: credencial inexistente");
        require(!cred.revoked, "IslamicPassport: credencial ja revogada");
        require(
            cred.issuer == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "IslamicPassport: sem permissao para revogar"
        );

        cred.revoked = true;

        emit CredentialRevoked(credentialId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════
    //  F) Consultas e listagem
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Retorna o DID no formato did:ethr:<chainId>:<address>.
     */
    function getDID(address user) external view returns (string memory) {
        return string(
            abi.encodePacked(
                "did:ethr:",
                _uint2str(deployChainId),
                ":",
                _addr2str(user)
            )
        );
    }

    /**
     * @notice Retorna o perfil (hashes + uri) de um usuário.
     */
    function getProfile(address user)
        external
        view
        returns (
            uint256 userId,
            bytes32 hNomeOficial,
            bytes32 hNomeMuculmano,
            bytes32 hMesquita,
            string memory uri,
            bool exists
        )
    {
        Profile storage p = _profiles[user];
        return (p.userId, p.hNomeOficial, p.hNomeMuculmano, p.hMesquita, p.uri, p.exists);
    }

    /**
     * @notice Retorna a lista de credentialIds de um subject.
     */
    function getCredentialsOf(address user) external view returns (uint256[] memory) {
        return _userCredentials[user];
    }

    /**
     * @notice Retorna a struct completa de uma credencial.
     */
    function getCredential(uint256 id)
        external
        view
        returns (
            uint256 credId,
            CredentialType credType,
            address issuer,
            address subject,
            bytes32 claimHash,
            string memory uri,
            uint256 issuedAt,
            bool revoked
        )
    {
        Credential storage c = _credentials[id];
        require(c.id != 0, "IslamicPassport: credencial inexistente");
        return (c.id, c.credType, c.issuer, c.subject, c.claimHash, c.uri, c.issuedAt, c.revoked);
    }

    /**
     * @notice Lista todos os endereços com papel SHEIK.
     */
    function listSheikhs() external view returns (address[] memory) {
        return _sheikhs;
    }

    /**
     * @notice Verifica se um endereço é sheik.
     */
    function isSheikh(address user) external view returns (bool) {
        return _isSheikh[user];
    }

    /**
     * @notice Retorna o total de credenciais emitidas.
     */
    function totalCredentials() external view returns (uint256) {
        return _nextCredentialId - 1;
    }

    /**
     * @notice Retorna o total de usuários registrados.
     */
    function totalUsers() external view returns (uint256) {
        return _nextUserId - 1;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Funções internas
    // ═══════════════════════════════════════════════════════════════

    /**
     * @dev Emite uma credencial e armazena on-chain. Retorna o credentialId.
     */
    function _issueCredential(
        CredentialType credType,
        address issuer,
        address subject,
        bytes32 claimHash,
        string memory uri
    ) internal returns (uint256) {
        uint256 credId = _nextCredentialId++;

        _credentials[credId] = Credential({
            id: credId,
            credType: credType,
            issuer: issuer,
            subject: subject,
            claimHash: claimHash,
            uri: uri,
            issuedAt: block.timestamp,
            revoked: false
        });

        _userCredentials[subject].push(credId);

        emit CredentialIssued(credId, credType, issuer, subject, claimHash, uri);

        return credId;
    }

    /**
     * @dev Adiciona sheik ao array de listagem (evita duplicatas).
     */
    function _addSheikh(address user) internal {
        if (!_isSheikh[user]) {
            _isSheikh[user] = true;
            _sheikhs.push(user);
        }
    }

    // ───────── Helpers de conversão para DID ─────────

    /**
     * @dev Converte uint256 para string decimal.
     */
    function _uint2str(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /**
     * @dev Converte address para string hexadecimal com prefixo 0x (lowercase).
     */
    function _addr2str(address addr) internal pure returns (string memory) {
        bytes memory s = new bytes(42);
        s[0] = "0";
        s[1] = "x";
        bytes memory hexAlphabet = "0123456789abcdef";
        for (uint256 i = 0; i < 20; i++) {
            s[2 + i * 2] = hexAlphabet[uint8(uint160(addr) >> (8 * (19 - i)) >> 4) & 0x0f];
            s[3 + i * 2] = hexAlphabet[uint8(uint160(addr) >> (8 * (19 - i))) & 0x0f];
        }
        return string(s);
    }
}
