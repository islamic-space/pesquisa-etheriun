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
        SHEIK_CERTIFICATE
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

    uint256 private _nextUserId = 1;
    uint256 private _nextCredentialId = 1;

    mapping(address => Profile) private _profiles;
    mapping(uint256 => Credential) private _credentials;
    mapping(address => uint256[]) private _userCredentials;
    address[] private _sheikhs;
    mapping(address => bool) private _isSheikh;
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
