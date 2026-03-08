// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

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

contract IslamicPassportV2 is AccessControl {
    bytes32 public constant SHEIK_ROLE = keccak256("SHEIK_ROLE");
    bytes32 public constant SUPER_ADMIN_ROLE = keccak256("SUPER_ADMIN_ROLE");

    enum CredentialType {
        INITIAL,
        MUSLIM_ATTESTATION,
        SHEIK_CERTIFICATE,
        DYNAMIC_CERTIFICATE
    }

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

    struct Credential {
        uint256 id;
        CredentialType credType;
        address issuer;
        address subject;
        bytes32 claimHash;
        string uri;
        uint256 issuedAt;
        bool revoked;
    }

    enum DynamicAudienceRule {
        ANYONE,
        MUSLIM_ONLY,
        SHEIK_ONLY,
        REQUIRES_DYNAMIC_CERT
    }

    enum DynamicCertificateCategory {
        PALESTRA,
        CURSO,
        EVENTO_GERAL,
        DAWA,
        OUTROS
    }

    struct DynamicCertificateType {
        uint256 id;
        bytes32 slug;
        string name;
        string description;
        DynamicAudienceRule audienceRule;
        uint256[] prerequisiteTypeIds;
        DynamicCertificateCategory category;
        bool isPublic;
        uint256 createdAt;
        address createdBy;
        uint256 publicationFee;
        address payoutAddress;
        address[] authorizedSheikhs;
        bool exists;
    }

    struct DynamicCredentialStatus {
        uint256 typeId;
        bool published;
        uint256 publicationFee;
        address payoutAddress;
        uint256 paidAmount;
    }

    struct CreateDynamicCertificateInput {
        string name;
        string description;
        DynamicAudienceRule audienceRule;
        uint256[] prerequisiteTypeIds;
        DynamicCertificateCategory category;
        bool isPublic;
        address payoutAddress;
        uint256 publicationFee;
        address[] authorizedSheikhs;
    }

    uint256 private _nextUserId = 1;
    uint256 private _nextCredentialId = 1;
    uint256 private _nextDynamicTypeId = 1;

    mapping(address => Profile) private _profiles;
    mapping(uint256 => Credential) private _credentials;
    mapping(address => uint256[]) private _userCredentials;
    address[] private _sheikhs;
    mapping(address => bool) private _isSheikh;
    mapping(uint256 => DynamicCertificateType) private _dynamicCertificateTypes;
    mapping(bytes32 => uint256) private _dynamicCertificateSlugIndex;
    mapping(uint256 => mapping(address => bool)) private _dynamicAuthorizedSheikhs;
    mapping(address => mapping(uint256 => uint256)) private _activeDynamicCertificates;
    mapping(uint256 => uint256) private _credentialDynamicType;
    mapping(uint256 => DynamicCredentialStatus) private _dynamicCredentialStatus;
    uint256[] private _dynamicTypeIds;
    uint256 public deployChainId;

    address public immutable legacyContract;

    mapping(address => bool) private _knownUsers;
    mapping(address => uint256) private _activeMuslimAttestations;
    mapping(address => uint256) private _activeSheikhCertificates;

    bool private _firstSheikhAssigned;
    address private _superAdmin;

    uint256 public contractDeployedAt;

    string private constant _CONTRACT_NAME = "IslamicPassport";
    string private constant _CONTRACT_VERSION = "2.1.0";
    string private constant _CONTRACT_DEPLOY_DATE = "2024-03-07";
    string private constant _CONTRACT_AUTHORS =
        "[{\"name\":\"Carlos Delfino\",\"email\":\"consultoria@carlosdelfino.eti.br\",\"eth\":\"0x841B788FFcbAdFabc5E8A2CfcBbeC93179B9ABef\",\"sol\":\"DMpnSvYmUfjrEkc5ZaFFEJTqKhyoATcAHBGgWZzucf9j\"}]";


    event ProfileRegistered(
        address indexed user,
        uint256 indexed userId,
        bytes32 hNomeOficial,
        bytes32 hNomeMuculmano,
        bytes32 hMesquita,
        string uri
    );

    event CredentialIssued(
        uint256 indexed credentialId,
        CredentialType credType,
        address indexed issuer,
        address indexed subject,
        bytes32 claimHash,
        string uri
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

    event DynamicCertificateTypeCreated(
        uint256 indexed typeId,
        bytes32 indexed slug,
        address indexed createdBy,
        string name,
        string emojiLog
    );

    event DynamicCertificateTypeUpdated(
        uint256 indexed typeId,
        bytes32 indexed slug,
        address indexed updatedBy,
        string name,
        string emojiLog
    );

    event DynamicCertificateIssued(
        uint256 indexed credentialId,
        uint256 indexed typeId,
        address indexed subject,
        address issuer,
        string emojiLog
    );

    event DynamicCredentialPublicationPaid(
        uint256 indexed credentialId,
        address indexed payer,
        uint256 amount,
        address payout,
        string emojiLog
    );

    constructor(address legacyAddress) {
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

        _issueCredential(CredentialType.INITIAL, address(this), msg.sender, bytes32(0), "");

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
        require(_profiles[subject].exists, "IslamicPassport: subject nao registrado");
        require(_canActAsAttestedSheikh(msg.sender), "IslamicPassport: apenas sheik atestado pode atestar");

        uint256 credId = _issueCredential(
            CredentialType.MUSLIM_ATTESTATION,
            msg.sender,
            subject,
            claimHash,
            optionalUri
        );

        emit AttestedMuslim(msg.sender, subject, credId);
    }

    function promoteToSheikh(
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external {
        require(_profiles[subject].exists, "IslamicPassport: subject nao registrado");
        require(!_isSheikh[subject], "IslamicPassport: subject ja e sheik");

        uint256 muslimCredId = 0;

        if (!_hasActiveMuslimAttestation(subject)) {
            muslimCredId = _issueCredential(
                CredentialType.MUSLIM_ATTESTATION,
                msg.sender,
                subject,
                bytes32(0),
                ""
            );
            emit AttestedMuslim(msg.sender, subject, muslimCredId);
        }

        _grantRole(SHEIK_ROLE, subject);
        _addSheikh(subject);

        uint256 credId = _issueCredential(
            CredentialType.SHEIK_CERTIFICATE,
            msg.sender,
            subject,
            claimHash,
            optionalUri
        );

        if (!_firstSheikhAssigned) {
            _firstSheikhAssigned = true;
        }

        emit SheikhPromoted(msg.sender, subject, credId);
    }

    function revokeCredential(uint256 credentialId) external {
        Credential storage cred = _credentials[credentialId];
        require(cred.id != 0, "IslamicPassport: credencial inexistente");
        require(!cred.revoked, "IslamicPassport: credencial ja revogada");
        require(
            cred.issuer == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "IslamicPassport: sem permissao para revogar"
        );

        cred.revoked = true;
        _afterCredentialRevoked(cred);

        emit CredentialRevoked(credentialId, msg.sender);
    }

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
        return _userCredentials[user];
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
        Credential storage c = _credentials[id];
        require(c.id != 0, "IslamicPassport: credencial inexistente");
        return (c.id, c.credType, c.issuer, c.subject, c.claimHash, c.uri, c.issuedAt, c.revoked);
    }

    function listSheikhs() external view returns (address[] memory) {
        return _sheikhs;
    }

    function isSheikh(address user) external view returns (bool) {
        return _isSheikh[user] && _activeSheikhCertificates[user] > 0;
    }

    function totalCredentials() external view returns (uint256) {
        return _nextCredentialId - 1;
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
                    _uint2str(contractDeployedAt),
                    "\",",
                    "\"deployChainId\":\"",
                    _uint2str(deployChainId),
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
        return _dynamicTypeIds.length;
    }

    function listDynamicCertificateTypes() external view returns (DynamicCertificateType[] memory types_) {
        uint256 len = _dynamicTypeIds.length;
        types_ = new DynamicCertificateType[](len);
        for (uint256 i = 0; i < len; i++) {
            types_[i] = _dynamicCertificateTypes[_dynamicTypeIds[i]];
        }
    }

    function getDynamicCertificateType(uint256 typeId) external view returns (DynamicCertificateType memory type_) {
        type_ = _dynamicCertificateTypes[typeId];
        require(type_.exists, unicode"❓ IslamicPassport: tipo dinamico inexistente");
    }

    function getDynamicCertificateAuthorizedSheikhs(uint256 typeId)
        external
        view
        returns (address[] memory sheikhs)
    {
        DynamicCertificateType storage record = _dynamicCertificateTypes[typeId];
        require(record.exists, unicode"❓ IslamicPassport: tipo dinamico inexistente");
        sheikhs = record.authorizedSheikhs;
    }

    function isAuthorizedForDynamicCertificate(uint256 typeId, address sheikh) external view returns (bool) {
        return _dynamicAuthorizedSheikhs[typeId][sheikh];
    }

    function getDynamicCredentialStatus(uint256 credentialId)
        external
        view
        returns (DynamicCredentialStatus memory status)
    {
        Credential storage cred = _credentials[credentialId];
        require(cred.id != 0, unicode"❌ IslamicPassport: credencial inexistente");
        require(cred.credType == CredentialType.DYNAMIC_CERTIFICATE, unicode"🎫 IslamicPassport: tipo invalido");
        status = _dynamicCredentialStatus[credentialId];
        require(status.typeId != 0, unicode"⚙️ IslamicPassport: status dinamico inexistente");
    }

    function getActiveDynamicCredential(address subject, uint256 typeId) external view returns (uint256) {
        return _activeDynamicCertificates[subject][typeId];
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

        bytes32 slug = _generateCertificateSlug(input.name);
        require(_dynamicCertificateSlugIndex[slug] == 0, unicode"♻️ IslamicPassport: certificado ja existe");

        if (input.audienceRule == DynamicAudienceRule.REQUIRES_DYNAMIC_CERT) {
            require(input.prerequisiteTypeIds.length > 0, unicode"🔁 IslamicPassport: prerequisitos obrigatorios");
        }

        uint256 typeId = _nextDynamicTypeId++;
        DynamicCertificateType storage record = _dynamicCertificateTypes[typeId];
        record.id = typeId;
        record.slug = slug;
        record.name = input.name;
        record.description = input.description;
        record.audienceRule = input.audienceRule;
        _setDynamicPrerequisites(record, input.prerequisiteTypeIds);
        record.category = input.category;
        record.isPublic = input.isPublic;
        record.createdAt = block.timestamp;
        record.createdBy = msg.sender;
        record.publicationFee = input.publicationFee;
        record.payoutAddress = input.payoutAddress;
        record.exists = true;

        _dynamicCertificateSlugIndex[slug] = typeId;
        _dynamicTypeIds.push(typeId);

        _primeAuthorizedSheikhs(typeId, record, input.authorizedSheikhs);
        require(record.authorizedSheikhs.length > 0, unicode"👳 IslamicPassport: ao menos um sheik autorizado");

        emit DynamicCertificateTypeCreated(
            typeId,
            slug,
            msg.sender,
            record.name,
            unicode"🎖️ Novo certificado dinamico criado"
        );

        return typeId;
    }

    function updateDynamicCertificateType(uint256 typeId, CreateDynamicCertificateInput calldata input) external {
        DynamicCertificateType storage record = _dynamicCertificateTypes[typeId];
        require(record.exists, unicode"❓ IslamicPassport: tipo dinamico inexistente");
        require(
            hasRole(SUPER_ADMIN_ROLE, msg.sender) || _dynamicAuthorizedSheikhs[typeId][msg.sender],
            unicode"🔐 IslamicPassport: acesso negado para atualizar"
        );
        require(bytes(input.name).length > 2, unicode"📛 IslamicPassport: nome do certificado invalido");

        if (input.audienceRule == DynamicAudienceRule.REQUIRES_DYNAMIC_CERT) {
            require(input.prerequisiteTypeIds.length > 0, unicode"🔁 IslamicPassport: prerequisitos obrigatorios");
        }

        bytes32 newSlug = _generateCertificateSlug(input.name);
        if (newSlug != record.slug) {
            uint256 existing = _dynamicCertificateSlugIndex[newSlug];
            require(existing == 0 || existing == typeId, unicode"♻️ IslamicPassport: slug em uso");
            _dynamicCertificateSlugIndex[record.slug] = 0;
            _dynamicCertificateSlugIndex[newSlug] = typeId;
            record.slug = newSlug;
        }

        record.name = input.name;
        record.description = input.description;
        record.audienceRule = input.audienceRule;
        _setDynamicPrerequisites(record, input.prerequisiteTypeIds);
        record.category = input.category;
        record.isPublic = input.isPublic;
        record.publicationFee = input.publicationFee;
        record.payoutAddress = input.payoutAddress;

        _resetAuthorizedSheikhs(typeId, record);
        _primeAuthorizedSheikhs(typeId, record, input.authorizedSheikhs);
        require(record.authorizedSheikhs.length > 0, unicode"👳 IslamicPassport: ao menos um sheik autorizado");

        emit DynamicCertificateTypeUpdated(
            typeId,
            record.slug,
            msg.sender,
            record.name,
            unicode"🛠️ Certificado dinamico atualizado"
        );
    }

    function issueDynamicCertificate(
        uint256 typeId,
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external returns (uint256) {
        DynamicCertificateType storage record = _dynamicCertificateTypes[typeId];
        require(record.exists, unicode"❓ IslamicPassport: tipo dinamico inexistente");
        require(_profiles[subject].exists, unicode"🪪 IslamicPassport: perfil nao encontrado");
        require(
            _dynamicAuthorizedSheikhs[typeId][msg.sender],
            unicode"🚫 IslamicPassport: sheik nao autorizado para este certificado"
        );
        require(
            _activeDynamicCertificates[subject][typeId] == 0,
            unicode"♻️ IslamicPassport: sujeito ja possui esta credencial"
        );

        _validateDynamicAudience(record, subject);
        _validateDynamicPrerequisites(record, subject);

        uint256 credId = _issueCredential(
            CredentialType.DYNAMIC_CERTIFICATE,
            msg.sender,
            subject,
            claimHash,
            optionalUri
        );

        _credentialDynamicType[credId] = typeId;
        _activeDynamicCertificates[subject][typeId] = credId;

        DynamicCredentialStatus storage status = _dynamicCredentialStatus[credId];
        status.typeId = typeId;
        status.published = record.publicationFee == 0;
        status.publicationFee = record.publicationFee;
        status.payoutAddress = record.payoutAddress != address(0) ? record.payoutAddress : msg.sender;
        status.paidAmount = 0;

        emit DynamicCertificateIssued(
            credId,
            typeId,
            subject,
            msg.sender,
            unicode"🌙 Certificado dinamico emitido"
        );

        return credId;
    }

    function payDynamicCredentialPublication(uint256 credentialId) external payable {
        Credential storage cred = _credentials[credentialId];
        require(cred.id != 0, unicode"❌ IslamicPassport: credencial inexistente");
        require(cred.subject == msg.sender, unicode"🙅 IslamicPassport: apenas o titular pode pagar");
        require(cred.credType == CredentialType.DYNAMIC_CERTIFICATE, unicode"🎫 IslamicPassport: tipo invalido");

        DynamicCredentialStatus storage status = _dynamicCredentialStatus[credentialId];
        require(status.typeId != 0, unicode"⚙️ IslamicPassport: status dinamico inexistente");
        require(!status.published, unicode"📢 IslamicPassport: certificado ja publicado");
        require(status.publicationFee > 0, unicode"💸 IslamicPassport: nenhuma taxa configurada");
        require(msg.value == status.publicationFee, unicode"💰 IslamicPassport: valor incorreto");

        status.paidAmount = msg.value;
        status.published = true;

        address payout = status.payoutAddress != address(0) ? status.payoutAddress : cred.issuer;
        (bool ok, ) = payout.call{value: msg.value}("");
        require(ok, unicode"🔥 IslamicPassport: falha ao transferir taxa");

        emit DynamicCredentialPublicationPaid(
            credentialId,
            msg.sender,
            msg.value,
            payout,
            unicode"💎 Taxa de publicacao quitada"
        );
    }

    function _migrateFromLegacy(address legacyAddress) internal {
        ILegacyIslamicPassport legacy = ILegacyIslamicPassport(legacyAddress);
        deployChainId = legacy.deployChainId();
        uint256 legacyTotalCredentials = legacy.totalCredentials();
        uint256 maxUserId = 0;
        bool hasAnyActiveSheikh = false;

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

            _credentials[credId] = Credential({
                id: credId,
                credType: CredentialType(credTypeRaw),
                issuer: issuer,
                subject: subject,
                claimHash: claimHash,
                uri: uri,
                issuedAt: issuedAt,
                revoked: revoked
            });

            _userCredentials[subject].push(credId);

            if (credId >= _nextCredentialId) {
                _nextCredentialId = credId + 1;
            }

            if (!revoked) {
                if (CredentialType(credTypeRaw) == CredentialType.MUSLIM_ATTESTATION) {
                    _activeMuslimAttestations[subject] += 1;
                } else if (CredentialType(credTypeRaw) == CredentialType.SHEIK_CERTIFICATE) {
                    _activeSheikhCertificates[subject] += 1;
                    hasAnyActiveSheikh = true;
                }
            }
        }

        address[] memory legacySheikhs = legacy.listSheikhs();
        for (uint256 i = 0; i < legacySheikhs.length; i++) {
            address sheikh = legacySheikhs[i];
            _migrateProfileFromLegacy(legacy, sheikh);
            if (_activeSheikhCertificates[sheikh] > 0) {
                _grantRole(SHEIK_ROLE, sheikh);
                _addSheikh(sheikh);
            }
        }

        if (_superAdmin != address(0)) {
            _grantRole(SUPER_ADMIN_ROLE, _superAdmin);
        }

        if (hasAnyActiveSheikh) {
            _firstSheikhAssigned = true;
        }

        if (maxUserId > 0) {
            _nextUserId = maxUserId + 1;
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

    function _issueCredential(
        CredentialType credType,
        address issuer,
        address subject,
        bytes32 claimHash,
        string memory uri
    ) internal returns (uint256) {
        if (credType == CredentialType.INITIAL) {
            require(
                issuer == address(this),
                unicode"🤖 IslamicPassport: certificado INITIAL apenas via registro automático"
            );
        }

        if (credType == CredentialType.SHEIK_CERTIFICATE) {
            _validateSheikhCertificateIssuer(issuer);
        }

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

        if (credType == CredentialType.MUSLIM_ATTESTATION) {
            _activeMuslimAttestations[subject] += 1;
        } else if (credType == CredentialType.SHEIK_CERTIFICATE) {
            _activeSheikhCertificates[subject] += 1;
        }

        emit CredentialIssued(credId, credType, issuer, subject, claimHash, uri);

        return credId;
    }

    function _validateSheikhCertificateIssuer(address issuer) internal view {
        if (!_firstSheikhAssigned) {
            require(
                hasRole(SUPER_ADMIN_ROLE, issuer),
                "IslamicPassport: apenas SuperAdmin pode emitir o primeiro certificado de sheik"
            );
        } else {
            require(
                _canActAsAttestedSheikh(issuer),
                "IslamicPassport: apenas sheik pode emitir certificado"
            );
        }
    }

    function _afterCredentialRevoked(Credential storage cred) internal {
        if (cred.credType == CredentialType.MUSLIM_ATTESTATION && _activeMuslimAttestations[cred.subject] > 0) {
            _activeMuslimAttestations[cred.subject] -= 1;
        }

        if (cred.credType == CredentialType.SHEIK_CERTIFICATE && _activeSheikhCertificates[cred.subject] > 0) {
            _activeSheikhCertificates[cred.subject] -= 1;
            if (_activeSheikhCertificates[cred.subject] == 0 && _isSheikh[cred.subject]) {
                _removeSheikh(cred.subject);
                if (hasRole(SHEIK_ROLE, cred.subject)) {
                    _revokeRole(SHEIK_ROLE, cred.subject);
                }
            }
        }

        if (cred.credType == CredentialType.DYNAMIC_CERTIFICATE) {
            uint256 typeId = _credentialDynamicType[cred.id];
            if (typeId != 0 && _activeDynamicCertificates[cred.subject][typeId] == cred.id) {
                _activeDynamicCertificates[cred.subject][typeId] = 0;
            }
        }
    }

    function _addSheikh(address user) internal {
        if (!_isSheikh[user]) {
            _isSheikh[user] = true;
            _sheikhs.push(user);
        }
    }

    function _removeSheikh(address user) internal {
        _isSheikh[user] = false;

        uint256 len = _sheikhs.length;
        for (uint256 i = 0; i < len; i++) {
            if (_sheikhs[i] == user) {
                _sheikhs[i] = _sheikhs[len - 1];
                _sheikhs.pop();
                break;
            }
        }
    }

    function _hasActiveMuslimAttestation(address user) internal view returns (bool) {
        return _activeMuslimAttestations[user] > 0;
    }

    function _canActAsAttestedSheikh(address user) internal view returns (bool) {
        return hasRole(SHEIK_ROLE, user) && _activeSheikhCertificates[user] > 0;
    }

    function _isValidDynamicType(uint256 typeId) internal view returns (bool) {
        return _dynamicCertificateTypes[typeId].exists;
    }

    function _setDynamicPrerequisites(
        DynamicCertificateType storage record,
        uint256[] calldata prerequisiteTypeIds
    ) internal {
        delete record.prerequisiteTypeIds;
        for (uint256 i = 0; i < prerequisiteTypeIds.length; i++) {
            uint256 prereqId = prerequisiteTypeIds[i];
            require(_isValidDynamicType(prereqId), unicode"🧩 IslamicPassport: prerequisito inexistente");
            require(prereqId != record.id, unicode"🔄 IslamicPassport: prerequisito nao pode ser o proprio tipo");
            record.prerequisiteTypeIds.push(prereqId);
        }
    }

    function _resetAuthorizedSheikhs(uint256 typeId, DynamicCertificateType storage record) internal {
        address[] storage current = record.authorizedSheikhs;
        for (uint256 i = 0; i < current.length; i++) {
            _dynamicAuthorizedSheikhs[typeId][current[i]] = false;
        }
        delete record.authorizedSheikhs;
    }

    function _primeAuthorizedSheikhs(
        uint256 typeId,
        DynamicCertificateType storage record,
        address[] calldata provided
    ) internal {
        if (_canActAsAttestedSheikh(msg.sender)) {
            _addAuthorizedSheikh(typeId, record, msg.sender);
        }

        for (uint256 i = 0; i < provided.length; i++) {
            _addAuthorizedSheikh(typeId, record, provided[i]);
        }
    }

    function _addAuthorizedSheikh(
        uint256 typeId,
        DynamicCertificateType storage record,
        address sheikh
    ) internal {
        if (sheikh == address(0) || _dynamicAuthorizedSheikhs[typeId][sheikh]) {
            return;
        }
        require(_canActAsAttestedSheikh(sheikh), unicode"👳 IslamicPassport: endereco nao e sheik ativo");
        _dynamicAuthorizedSheikhs[typeId][sheikh] = true;
        record.authorizedSheikhs.push(sheikh);
    }

    function _validateDynamicAudience(DynamicCertificateType storage record, address subject) internal view {
        if (record.audienceRule == DynamicAudienceRule.MUSLIM_ONLY) {
            require(_hasActiveMuslimAttestation(subject), unicode"🕌 IslamicPassport: requer atestado musulmano");
        } else if (record.audienceRule == DynamicAudienceRule.SHEIK_ONLY) {
            require(_activeSheikhCertificates[subject] > 0, unicode"👳 IslamicPassport: requer sheik ativo");
        }
    }

    function _validateDynamicPrerequisites(
        DynamicCertificateType storage record,
        address subject
    ) internal view {
        if (record.prerequisiteTypeIds.length == 0) {
            return;
        }
        for (uint256 i = 0; i < record.prerequisiteTypeIds.length; i++) {
            uint256 prereqType = record.prerequisiteTypeIds[i];
            require(
                _activeDynamicCertificates[subject][prereqType] != 0,
                unicode"🧾 IslamicPassport: prerequisitos nao atendidos"
            );
        }
    }

    function _normalizeName(string memory value) internal pure returns (string memory) {
        bytes memory input = bytes(value);
        bytes memory buffer = new bytes(input.length);
        uint256 count = 0;
        bool lastWasSpace = true;

        for (uint256 i = 0; i < input.length; i++) {
            bytes1 char = input[i];
            if (char == 0x20 || char == 0x09) {
                if (!lastWasSpace && count > 0) {
                    buffer[count++] = 0x20;
                    lastWasSpace = true;
                }
                continue;
            }

            if (char >= 0x41 && char <= 0x5A) {
                buffer[count++] = bytes1(uint8(char) + 32);
            } else {
                buffer[count++] = char;
            }
            lastWasSpace = false;
        }

        if (count > 0 && buffer[count - 1] == 0x20) {
            count -= 1;
        }

        bytes memory trimmed = new bytes(count);
        for (uint256 j = 0; j < count; j++) {
            trimmed[j] = buffer[j];
        }
        return string(trimmed);
    }

    function _generateCertificateSlug(string memory name) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_normalizeName(name)));
    }

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
