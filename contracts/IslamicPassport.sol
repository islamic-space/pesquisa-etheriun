// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import {IIslamicPassportCertificates} from "./interfaces/IIslamicPassportCertificates.sol";
import {IIslamicPassportFacade} from "./interfaces/IIslamicPassportFacade.sol";
import {IslamicPassportStringLib} from "./libraries/IslamicPassportStringLib.sol";
import {
    Credential,
    CredentialType,
    DynamicCredentialStatus,
    DynamicCertificateType,
    DynamicAudienceRule,
    DynamicCertificateCategory,
    CreateDynamicCertificateInput,
    IIslamicPassportEvents
} from "./types/IslamicPassportDataTypes.sol";

interface ILegacyIslamicPassport {
    function getDID(address user) external view returns (string memory);
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
        );
    function getCredentialsOf(address user) external view returns (uint256[] memory);
    function getCredential(uint256 id)
        external
        view
        returns (
            uint256 credId,
            uint8 credType,
            address issuer,
            address subject,
            bytes32 claimHash,
            string memory uri,
            uint256 issuedAt,
            bool revoked
        );
    function listSheikhs() external view returns (address[] memory);
    function isSheikh(address user) external view returns (bool);
    function totalCredentials() external view returns (uint256);
    function totalUsers() external view returns (uint256);
    function deployChainId() external view returns (uint256);
}

contract IslamicPassportV2 is AccessControl, IIslamicPassportFacade, IIslamicPassportEvents {
    using IslamicPassportStringLib for uint256;
    using IslamicPassportStringLib for address;
    bytes32 public constant SHEIK_ROLE = keccak256("SHEIK_ROLE");
    bytes32 public constant SUPER_ADMIN_ROLE = keccak256("SUPER_ADMIN_ROLE");

    struct AttestationTypeMeta {
        uint8 id;
        string key;
        string label;
        string description;
    }

    struct Profile {
        uint256 userId;
        bytes32 hNomeOficial;
        bytes32 hNomeMuculmano;
        bytes32 hMesquita;
        string uri;
        bool exists;
    }

    uint256 private _nextUserId = 1;
    mapping(address => Profile) private _profiles;
    mapping(address => bool) private _knownUsers;

    uint256 public deployChainId;
    address public immutable legacyContract;
    uint256 public contractDeployedAt;

    address private _superAdmin;
    IIslamicPassportCertificates public certificates;

    string private constant _CONTRACT_NAME = "IslamicPassport";
    string private constant _CONTRACT_VERSION = "2.1.0";
    string private constant _CONTRACT_DEPLOY_DATE = "2024-03-07";
    string private constant _CONTRACT_AUTHORS =
        "[{\"name\":\"Carlos Delfino\",\"email\":\"consultoria@carlosdelfino.eti.br\",\"eth\":\"0x841B788FFcbAdFabc5E8A2CfcBbeC93179B9ABef\",\"sol\":\"DMpnSvYmUfjrEkc5ZaFFEJTqKhyoATcAHBGgWZzucf9j\"}]";


    constructor(address legacyAddress, address certificatesAddress) {
        require(certificatesAddress != address(0), unicode"🚫 IslamicPassport: gestor de certificados invalido");
        certificates = IIslamicPassportCertificates(certificatesAddress);
        certificates.bindFacade(address(this));

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        deployChainId = block.chainid;
        contractDeployedAt = block.timestamp;
        legacyContract = legacyAddress;

        if (legacyAddress != address(0)) {
            _migrateFromLegacy(legacyAddress);
        }
    }

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

        _knownUsers[msg.sender] = true;

        emit ProfileRegistered(msg.sender, userId, hNomeOficial, hNomeMuculmano, hMesquita, optionalUri);

        uint256 credentialId = certificates.issueInitialCredential(msg.sender, optionalUri);
        emit CredentialIssued(credentialId, CredentialType.INITIAL, address(this), msg.sender, bytes32(0), optionalUri);

        if (userId == 1 && _superAdmin == address(0)) {
            _superAdmin = msg.sender;
            _grantRole(SUPER_ADMIN_ROLE, msg.sender);
        }
    }

    function attestMuslim(
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external onlyRole(SHEIK_ROLE) {
        uint256 credId = certificates.attestMuslim(msg.sender, subject, claimHash, optionalUri);
        emit CredentialIssued(credId, CredentialType.MUSLIM_ATTESTATION, msg.sender, subject, claimHash, optionalUri);
        emit AttestedMuslim(msg.sender, subject, credId);
    }

    function promoteToSheikh(
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external {
        (uint256 muslimCredId, uint256 sheikhCredId) = certificates.promoteToSheikh(
            msg.sender,
            subject,
            claimHash,
            optionalUri
        );

        if (muslimCredId > 0) {
            emit CredentialIssued(muslimCredId, CredentialType.MUSLIM_ATTESTATION, msg.sender, subject, bytes32(0), "");
            emit AttestedMuslim(msg.sender, subject, muslimCredId);
        }

        emit CredentialIssued(sheikhCredId, CredentialType.SHEIK_CERTIFICATE, msg.sender, subject, claimHash, optionalUri);
        emit SheikhPromoted(msg.sender, subject, sheikhCredId);
    }

    function revokeCredential(uint256 credentialId) external {
        certificates.revokeCredential(msg.sender, hasRole(DEFAULT_ADMIN_ROLE, msg.sender), credentialId);
        emit CredentialRevoked(credentialId, msg.sender);
    }

    function getDID(address user) external view returns (string memory) {
        return string(
            abi.encodePacked(
                "did:ethr:",
                deployChainId.uintToString(),
                ":",
                user.addressToString()
            )
        );
    }

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

    function getCredentialsOf(address user) external view returns (uint256[] memory) {
        return certificates.getCredentialsOf(user);
    }

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
        Credential memory c = certificates.getCredential(id);
        return (c.id, c.credType, c.issuer, c.subject, c.claimHash, c.uri, c.issuedAt, c.revoked);
    }

    function listSheikhs() external view returns (address[] memory) {
        return certificates.listSheikhs();
    }

    function isSheikh(address user) external view returns (bool) {
        return certificates.isSheikh(user);
    }

    function totalCredentials() external view returns (uint256) {
        return certificates.totalCredentials();
    }

    function totalUsers() external view returns (uint256) {
        return _nextUserId - 1;
    }

    function identifyContract() external view returns (string memory) {
        return
            string(
                abi.encodePacked(
                    "{",
                    "\"name\":\"",
                    _CONTRACT_NAME,
                    "\",",
                    "\"version\":\"",
                    _CONTRACT_VERSION,
                    "\",",
                    "\"deployDate\":\"",
                    _CONTRACT_DEPLOY_DATE,
                    "\",",
                    "\"deployTimestamp\":\"",
                    contractDeployedAt.uintToString(),
                    "\",",
                    "\"deployChainId\":\"",
                    deployChainId.uintToString(),
                    "\",",
                    "\"authors\":",
                    _CONTRACT_AUTHORS,
                    "}"
                )
            );
    }

    function getAvailableAttestationTypes() external pure returns (AttestationTypeMeta[] memory types_) {
        types_ = new AttestationTypeMeta[](3);

        types_[0] = AttestationTypeMeta({
            id: uint8(CredentialType.INITIAL),
            key: "INITIAL",
            label: unicode"Registro Inicial",
            description: unicode"Credencial automática emitida ao registrar o perfil no Islamic Passport."
        });

        types_[1] = AttestationTypeMeta({
            id: uint8(CredentialType.MUSLIM_ATTESTATION),
            key: "MUSLIM_ATTESTATION",
            label: unicode"Atestado de Muçulmano",
            description: unicode"Certifica que o sujeito possui fé muçulmana reconhecida por um sheik."
        });

        types_[2] = AttestationTypeMeta({
            id: uint8(CredentialType.SHEIK_CERTIFICATE),
            key: "SHEIK_CERTIFICATE",
            label: unicode"Certificado de Sheik",
            description: unicode"Concede autoridade para emitir atestos e promover novos sheiks."
        });
    }

    function totalDynamicCertificateTypes() external view returns (uint256) {
        return certificates.totalDynamicCertificateTypes();
    }

    function listDynamicCertificateTypes() external view returns (DynamicCertificateType[] memory types_) {
        return certificates.listDynamicCertificateTypes();
    }

    function getDynamicCertificateType(uint256 typeId) external view returns (DynamicCertificateType memory type_) {
        return certificates.getDynamicCertificateType(typeId);
    }

    function getDynamicCertificateAuthorizedSheikhs(uint256 typeId)
        external
        view
        returns (address[] memory sheikhs)
    {
        return certificates.getDynamicCertificateAuthorizedSheikhs(typeId);
    }

    function isAuthorizedForDynamicCertificate(uint256 typeId, address sheikh) external view returns (bool) {
        return certificates.isAuthorizedForDynamicCertificate(typeId, sheikh);
    }

    function getDynamicCredentialStatus(uint256 credentialId)
        external
        view
        returns (DynamicCredentialStatus memory status)
    {
        return certificates.getDynamicCredentialStatus(credentialId);
    }

    function getActiveDynamicCredential(address subject, uint256 typeId) external view returns (uint256) {
        return certificates.getActiveDynamicCredential(subject, typeId);
    }

    function createDynamicCertificateType(CreateDynamicCertificateInput calldata input)
        external
        returns (uint256)
    {
        require(
            hasRole(SUPER_ADMIN_ROLE, msg.sender) || _canActAsAttestedSheikh(msg.sender),
            unicode"🔐 IslamicPassport: somente SuperAdmin ou Sheik ativo pode criar"
        );
        require(bytes(input.name).length > 2, unicode"📛 IslamicPassport: nome do certificado invalido");

        (uint256 typeId, bytes32 slug) = certificates.createDynamicCertificateType(msg.sender, input);
        emit DynamicCertificateTypeCreated(typeId, slug, msg.sender, input.name, unicode"🎖️ Novo certificado dinamico criado");

        return typeId;
    }

    function updateDynamicCertificateType(uint256 typeId, CreateDynamicCertificateInput calldata input) external {
        DynamicCertificateType memory record = certificates.getDynamicCertificateType(typeId);
        require(record.exists, unicode"❓ IslamicPassport: tipo dinamico inexistente");
        require(bytes(input.name).length > 2, unicode"📛 IslamicPassport: nome do certificado invalido");
        require(
            hasRole(SUPER_ADMIN_ROLE, msg.sender) || certificates.isAuthorizedForDynamicCertificate(typeId, msg.sender),
            unicode"🔐 IslamicPassport: acesso negado para atualizar"
        );

        bytes32 newSlug = certificates.updateDynamicCertificateType(msg.sender, typeId, input);
        emit DynamicCertificateTypeUpdated(
            typeId,
            newSlug,
            msg.sender,
            input.name,
            unicode"🛠️ Certificado dinamico atualizado"
        );
    }

    function issueDynamicCertificate(
        uint256 typeId,
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external returns (uint256) {
        require(_profiles[subject].exists, unicode"🪪 IslamicPassport: perfil nao encontrado");

        uint256 credId = certificates.issueDynamicCertificate(msg.sender, typeId, subject, claimHash, optionalUri);
        emit DynamicCertificateIssued(credId, typeId, subject, msg.sender, unicode"🌙 Certificado dinamico emitido");

        return credId;
    }

    function payDynamicCredentialPublication(uint256 credentialId) external payable {
        certificates.payDynamicCredentialPublication{value: msg.value}(msg.sender, credentialId);

        DynamicCredentialStatus memory status = certificates.getDynamicCredentialStatus(credentialId);
        Credential memory cred = certificates.getCredential(credentialId);
        address payout = status.payoutAddress != address(0) ? status.payoutAddress : cred.issuer;
        emit DynamicCredentialPublicationPaid(credentialId, msg.sender, msg.value, payout, unicode"💎 Taxa de publicacao quitada");
    }

    function _migrateFromLegacy(address legacyAddress) internal {
        ILegacyIslamicPassport legacy = ILegacyIslamicPassport(legacyAddress);
        deployChainId = legacy.deployChainId();
        uint256 legacyTotalCredentials = legacy.totalCredentials();
        uint256 maxUserId = 0;

        for (uint256 i = 1; i <= legacyTotalCredentials; i++) {
            (
                uint256 credId,
                uint8 credTypeRaw,
                address issuer,
                address subject,
                bytes32 claimHash,
                string memory uri,
                uint256 issuedAt,
                bool revoked
            ) = legacy.getCredential(i);

            _migrateProfileFromLegacy(legacy, subject);

            Profile storage p = _profiles[subject];
            if (p.userId > maxUserId) {
                maxUserId = p.userId;
            }
            if (p.userId == 1) {
                _superAdmin = subject;
            }

            if (!_credentialExistsInCertificates(credId)) {
                certificates.importLegacyCredential(
                    Credential({
                        id: credId,
                        credType: CredentialType(credTypeRaw),
                        issuer: issuer,
                        subject: subject,
                        claimHash: claimHash,
                        uri: uri,
                        issuedAt: issuedAt,
                        revoked: revoked
                    })
                );
            }
        }

        address[] memory legacySheikhs = legacy.listSheikhs();
        for (uint256 i = 0; i < legacySheikhs.length; i++) {
            address sheikh = legacySheikhs[i];
            _migrateProfileFromLegacy(legacy, sheikh);
            if (certificates.hasActiveSheikhCertificate(sheikh)) {
                _grantRole(SHEIK_ROLE, sheikh);
            }
        }

        if (_superAdmin != address(0)) {
            _grantRole(SUPER_ADMIN_ROLE, _superAdmin);
        }

        if (maxUserId > 0) {
            _nextUserId = maxUserId + 1;
        }
    }

    function _credentialExistsInCertificates(uint256 credId) internal view returns (bool) {
        try certificates.getCredential(credId) returns (Credential memory existing) {
            return existing.id != 0;
        } catch {
            return false;
        }
    }

    function _migrateProfileFromLegacy(ILegacyIslamicPassport legacy, address user) internal {
        if (_knownUsers[user]) {
            return;
        }

        (
            uint256 userId,
            bytes32 hNomeOficial,
            bytes32 hNomeMuculmano,
            bytes32 hMesquita,
            string memory uri,
            bool exists
        ) = legacy.getProfile(user);

        if (!exists) {
            return;
        }

        _profiles[user] = Profile({
            userId: userId,
            hNomeOficial: hNomeOficial,
            hNomeMuculmano: hNomeMuculmano,
            hMesquita: hMesquita,
            uri: uri,
            exists: true
        });

        _knownUsers[user] = true;
    }

    function _canActAsAttestedSheikh(address user) internal view returns (bool) {
        return hasRole(SHEIK_ROLE, user) && certificates.hasActiveSheikhCertificate(user);
    }

    modifier onlyCertificatesManager() {
        require(msg.sender == address(certificates), unicode"🔐 IslamicPassport: somente gestor de certificados autorizado");
        _;
    }

    function profileExists(address user) external view override returns (bool) {
        return _profiles[user].exists;
    }

    function canActAsAttestedSheikh(address user) external view override returns (bool) {
        return _canActAsAttestedSheikh(user);
    }

    function notifySheikhPromotion(address subject) external override onlyCertificatesManager {
        if (!hasRole(SHEIK_ROLE, subject)) {
            _grantRole(SHEIK_ROLE, subject);
        }
    }

    function notifySheikhDemotion(address subject) external override onlyCertificatesManager {
        if (hasRole(SHEIK_ROLE, subject)) {
            _revokeRole(SHEIK_ROLE, subject);
        }
    }

    function hasRole(bytes32 role, address account)
        public
        view
        override(AccessControl, IIslamicPassportFacade)
        returns (bool)
    {
        return super.hasRole(role, account);
    }
}
