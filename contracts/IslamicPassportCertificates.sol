// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IIslamicPassportCertificates} from "./interfaces/IIslamicPassportCertificates.sol";
import {IIslamicPassportFacade} from "./interfaces/IIslamicPassportFacade.sol";
import {
    Credential,
    CredentialType,
    DynamicCredentialStatus,
    DynamicCertificateType,
    DynamicAudienceRule,
    DynamicCertificateCategory,
    CreateDynamicCertificateInput
} from "./types/IslamicPassportDataTypes.sol";

/// @title IslamicPassportCertificates
/// @notice Contrato responsável pela gestão das credenciais do Islamic Passport.
///         Deve ser utilizado como backend por uma fachada (IslamicPassport.sol).
contract IslamicPassportCertificates is IIslamicPassportCertificates {

    error IslamicPassportCertificates__FacadeAlreadyBound();
    error IslamicPassportCertificates__InvalidFacade();
    error IslamicPassportCertificates__FacadeSelfBindRequired(address caller);
    error IslamicPassportCertificates__OnlyFacade(address caller);
    error IslamicPassportCertificates__CredentialMissing(uint256 credentialId);
    error IslamicPassportCertificates__CredentialAlreadyRevoked(uint256 credentialId);
    error IslamicPassportCertificates__CredentialUnauthorized(address caller);
    error IslamicPassportCertificates__DynamicTypeMissing(uint256 typeId);
    error IslamicPassportCertificates__DynamicStatusMissing(uint256 credentialId);
    error IslamicPassportCertificates__NameTooShort();
    error IslamicPassportCertificates__SlugAlreadyInUse(bytes32 slug);
    error IslamicPassportCertificates__AudiencePrerequisiteRequired();
    error IslamicPassportCertificates__NoAuthorizedSheikh(uint256 typeId);
    error IslamicPassportCertificates__SheikhNotActive(address sheikh);
    error IslamicPassportCertificates__FirstSheikhNeedsSuperAdmin();
    error IslamicPassportCertificates__InitialCredentialRestricted();
    error IslamicPassportCertificates__DuplicateDynamicCredential(address subject, uint256 typeId);
    error IslamicPassportCertificates__UnauthorizedDynamicIssuer(address caller, uint256 typeId);
    error IslamicPassportCertificates__MuslimAttestationRequired(address subject);
    error IslamicPassportCertificates__ActiveSheikhRequired(address subject);
    error IslamicPassportCertificates__UnknownPrerequisite(uint256 typeId);
    error IslamicPassportCertificates__MissingPrerequisite(uint256 typeId);
    error IslamicPassportCertificates__PrerequisiteCantReferenceSelf(uint256 typeId);
    error IslamicPassportCertificates__SubjectMismatch(address payer, address expected);
    error IslamicPassportCertificates__DynamicCredentialExpected(uint256 credentialId);
    error IslamicPassportCertificates__PublicationAlreadyPaid(uint256 credentialId);
    error IslamicPassportCertificates__PublicationFeeUnset(uint256 credentialId);
    error IslamicPassportCertificates__PublicationValueMismatch(uint256 expected, uint256 provided);
    error IslamicPassportCertificates__PublicationTransferFailed();
    error IslamicPassportCertificates__ProfileMissing(address user);
    error IslamicPassportCertificates__SubjectAlreadySheikh(address subject);
    error IslamicPassportCertificates__UnauthorizedPromotion(address issuer);
    error IslamicPassportCertificates__InactiveAttestingSheikh(address issuer);

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

    event CertificatesMigrated(
        address indexed previousManager,
        uint256 migratedCredentials,
        uint256 migratedDynamicTypes,
        string emojiLog
    );

    address public facade;
    IIslamicPassportFacade private _facadeContract;

    bytes32 private constant SHEIK_ROLE = keccak256("SHEIK_ROLE");
    bytes32 private constant SUPER_ADMIN_ROLE = keccak256("SUPER_ADMIN_ROLE");

    constructor(address previousManager) {
        if (previousManager != address(0)) {
            _migrateFromPreviousManager(previousManager);
        }
    }

    uint256 private _nextCredentialId = 1;
    uint256 private _nextDynamicTypeId = 1;

    mapping(uint256 => Credential) private _credentials;
    mapping(address => uint256[]) private _userCredentials;
    address[] private _sheikhs;
    mapping(address => bool) private _isSheikh;
    mapping(address => uint256) private _activeMuslimAttestations;
    mapping(address => uint256) private _activeSheikhCertificates;
    bool private _firstSheikhAssigned;

    mapping(uint256 => DynamicCertificateType) private _dynamicCertificateTypes;
    mapping(bytes32 => uint256) private _dynamicCertificateSlugIndex;
    mapping(uint256 => mapping(address => bool)) private _dynamicAuthorizedSheikhs;
    mapping(address => mapping(uint256 => uint256)) private _activeDynamicCertificates;
    mapping(uint256 => uint256) private _credentialDynamicType;
    mapping(uint256 => DynamicCredentialStatus) private _dynamicCredentialStatus;
    uint256[] private _dynamicTypeIds;

    modifier onlyFacade() {
        if (msg.sender != facade) {
            revert IslamicPassportCertificates__OnlyFacade(msg.sender);
        }
        _;
    }

    function bindFacade(address newFacade) external {
        if (facade != address(0)) {
            revert IslamicPassportCertificates__FacadeAlreadyBound();
        }
        if (newFacade == address(0)) {
            revert IslamicPassportCertificates__InvalidFacade();
        }
        if (msg.sender != newFacade) {
            revert IslamicPassportCertificates__FacadeSelfBindRequired(msg.sender);
        }

        facade = newFacade;
        _facadeContract = IIslamicPassportFacade(newFacade);
    }

    // ======== VIEW FUNCTIONS ========

    function totalCredentials() external view returns (uint256) {
        return _nextCredentialId - 1;
    }

    function getCredentialsOf(address user) external view returns (uint256[] memory) {
        return _userCredentials[user];
    }

    function getCredential(uint256 id) external view returns (Credential memory cred) {
        cred = _credentials[id];
        if (cred.id == 0) {
            revert IslamicPassportCertificates__CredentialMissing(id);
        }
    }

    function listSheikhs() external view returns (address[] memory) {
        return _sheikhs;
    }

    function hasActiveMuslimAttestation(address user) external view returns (bool) {
        return _activeMuslimAttestations[user] > 0;
    }

    function hasActiveSheikhCertificate(address user) external view returns (bool) {
        return _activeSheikhCertificates[user] > 0;
    }

    function isSheikh(address user) external view returns (bool) {
        return _isSheikh[user] && _activeSheikhCertificates[user] > 0;
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
        if (!type_.exists) {
            revert IslamicPassportCertificates__DynamicTypeMissing(typeId);
        }
    }

    function getDynamicCertificateAuthorizedSheikhs(uint256 typeId)
        external
        view
        returns (address[] memory sheikhs)
    {
        DynamicCertificateType storage record = _dynamicCertificateTypes[typeId];
        if (!record.exists) {
            revert IslamicPassportCertificates__DynamicTypeMissing(typeId);
        }
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
        if (cred.id == 0) {
            revert IslamicPassportCertificates__CredentialMissing(credentialId);
        }
        if (cred.credType != CredentialType.DYNAMIC_CERTIFICATE) {
            revert IslamicPassportCertificates__DynamicCredentialExpected(credentialId);
        }
        status = _dynamicCredentialStatus[credentialId];
        if (status.typeId == 0) {
            revert IslamicPassportCertificates__DynamicStatusMissing(credentialId);
        }
    }

    function getActiveDynamicCredential(address subject, uint256 typeId) external view returns (uint256) {
        return _activeDynamicCertificates[subject][typeId];
    }

    // ======== FACADE-ONLY OPERATIONS ========

    function issueInitialCredential(address subject, string calldata optionalUri) external onlyFacade returns (uint256) {
        return _issueCredential(CredentialType.INITIAL, facade, subject, bytes32(0), optionalUri);
    }

    function attestMuslim(
        address issuer,
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external onlyFacade returns (uint256) {
        if (!_facadeContract.profileExists(subject)) {
            revert IslamicPassportCertificates__ProfileMissing(subject);
        }
        if (!_facadeContract.canActAsAttestedSheikh(issuer)) {
            revert IslamicPassportCertificates__InactiveAttestingSheikh(issuer);
        }
        uint256 credId = _issueCredential(CredentialType.MUSLIM_ATTESTATION, issuer, subject, claimHash, optionalUri);
        emit AttestedMuslim(issuer, subject, credId);
        return credId;
    }

    function promoteToSheikh(
        address issuer,
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external onlyFacade returns (uint256 muslimCredId, uint256 sheikhCredId) {
        if (!_facadeContract.profileExists(subject)) {
            revert IslamicPassportCertificates__ProfileMissing(subject);
        }
        if (_facadeContract.hasRole(SHEIK_ROLE, subject)) {
            revert IslamicPassportCertificates__SubjectAlreadySheikh(subject);
        }

        bool issuerIsSuperAdmin = _facadeContract.hasRole(SUPER_ADMIN_ROLE, issuer);
        if (!(issuerIsSuperAdmin || _facadeContract.canActAsAttestedSheikh(issuer))) {
            revert IslamicPassportCertificates__UnauthorizedPromotion(issuer);
        }

        if (!_hasActiveMuslimAttestation(subject)) {
            muslimCredId = _issueCredential(
                CredentialType.MUSLIM_ATTESTATION,
                issuer,
                subject,
                bytes32(0),
                ""
            );
            emit AttestedMuslim(issuer, subject, muslimCredId);
        }

        _validateSheikhCertificateIssuer(issuerIsSuperAdmin);
        _addSheikh(subject);
        _facadeContract.notifySheikhPromotion(subject);

        sheikhCredId = _issueCredential(CredentialType.SHEIK_CERTIFICATE, issuer, subject, claimHash, optionalUri);

        if (!_firstSheikhAssigned) {
            _firstSheikhAssigned = true;
        }

        emit SheikhPromoted(issuer, subject, sheikhCredId);
    }

    function revokeCredential(
        address caller,
        bool callerIsAdmin,
        uint256 credentialId
    ) external onlyFacade returns (address subject, bool subjectLostSheikhStatus) {
        Credential storage cred = _credentials[credentialId];
        if (cred.id == 0) {
            revert IslamicPassportCertificates__CredentialMissing(credentialId);
        }
        if (cred.revoked) {
            revert IslamicPassportCertificates__CredentialAlreadyRevoked(credentialId);
        }
        if (cred.issuer != caller && !callerIsAdmin) {
            revert IslamicPassportCertificates__CredentialUnauthorized(caller);
        }

        cred.revoked = true;
        subject = cred.subject;
        subjectLostSheikhStatus = _afterCredentialRevoked(cred);

        emit CredentialRevoked(credentialId, caller);

        if (subjectLostSheikhStatus) {
            _facadeContract.notifySheikhDemotion(subject);
        }
    }

    function createDynamicCertificateType(
        address caller,
        CreateDynamicCertificateInput calldata input
    ) external onlyFacade returns (uint256 typeId, bytes32 slug) {
        if (bytes(input.name).length <= 2) {
            revert IslamicPassportCertificates__NameTooShort();
        }

        slug = _generateCertificateSlug(input.name);
        if (_dynamicCertificateSlugIndex[slug] != 0) {
            revert IslamicPassportCertificates__SlugAlreadyInUse(slug);
        }

        if (input.audienceRule == DynamicAudienceRule.REQUIRES_DYNAMIC_CERT && input.prerequisiteTypeIds.length == 0) {
            revert IslamicPassportCertificates__AudiencePrerequisiteRequired();
        }

        typeId = _nextDynamicTypeId++;
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
        record.createdBy = caller;
        record.publicationFee = input.publicationFee;
        record.payoutAddress = input.payoutAddress;
        record.exists = true;

        _dynamicCertificateSlugIndex[slug] = typeId;
        _dynamicTypeIds.push(typeId);

        _primeAuthorizedSheikhs(typeId, record, input.authorizedSheikhs);
        if (record.authorizedSheikhs.length == 0) {
            revert IslamicPassportCertificates__NoAuthorizedSheikh(typeId);
        }

        emit DynamicCertificateTypeCreated(
            typeId,
            slug,
            caller,
            record.name,
            unicode"🎖️ Novo certificado dinamico criado"
        );
    }

    function updateDynamicCertificateType(
        address caller,
        uint256 typeId,
        CreateDynamicCertificateInput calldata input
    ) external onlyFacade returns (bytes32 newSlug) {
        DynamicCertificateType storage record = _dynamicCertificateTypes[typeId];
        if (!record.exists) {
            revert IslamicPassportCertificates__DynamicTypeMissing(typeId);
        }
        if (bytes(input.name).length <= 2) {
            revert IslamicPassportCertificates__NameTooShort();
        }

        if (input.audienceRule == DynamicAudienceRule.REQUIRES_DYNAMIC_CERT && input.prerequisiteTypeIds.length == 0) {
            revert IslamicPassportCertificates__AudiencePrerequisiteRequired();
        }

        newSlug = _generateCertificateSlug(input.name);
        if (newSlug != record.slug) {
            uint256 existing = _dynamicCertificateSlugIndex[newSlug];
            if (existing != 0 && existing != typeId) {
                revert IslamicPassportCertificates__SlugAlreadyInUse(newSlug);
            }
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
        if (record.authorizedSheikhs.length == 0) {
            revert IslamicPassportCertificates__NoAuthorizedSheikh(typeId);
        }

        emit DynamicCertificateTypeUpdated(
            typeId,
            record.slug,
            caller,
            record.name,
            unicode"🛠️ Certificado dinamico atualizado"
        );
    }

    function issueDynamicCertificate(
        address caller,
        uint256 typeId,
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external onlyFacade returns (uint256 credId) {
        DynamicCertificateType storage record = _dynamicCertificateTypes[typeId];
        if (!record.exists) {
            revert IslamicPassportCertificates__DynamicTypeMissing(typeId);
        }
        if (!_dynamicAuthorizedSheikhs[typeId][caller]) {
            revert IslamicPassportCertificates__UnauthorizedDynamicIssuer(caller, typeId);
        }
        if (_activeDynamicCertificates[subject][typeId] != 0) {
            revert IslamicPassportCertificates__DuplicateDynamicCredential(subject, typeId);
        }

        _validateDynamicAudience(record, subject);
        _validateDynamicPrerequisites(record, subject);

        credId = _issueCredential(
            CredentialType.DYNAMIC_CERTIFICATE,
            caller,
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
        status.payoutAddress = record.payoutAddress != address(0) ? record.payoutAddress : caller;
        status.paidAmount = 0;

        emit DynamicCertificateIssued(
            credId,
            typeId,
            subject,
            caller,
            unicode"🌙 Certificado dinamico emitido"
        );
    }

    function payDynamicCredentialPublication(address payer, uint256 credentialId)
        external
        payable
        onlyFacade
    {
        Credential storage cred = _credentials[credentialId];
        if (cred.id == 0) {
            revert IslamicPassportCertificates__CredentialMissing(credentialId);
        }
        if (cred.subject != payer) {
            revert IslamicPassportCertificates__SubjectMismatch(payer, cred.subject);
        }
        if (cred.credType != CredentialType.DYNAMIC_CERTIFICATE) {
            revert IslamicPassportCertificates__DynamicCredentialExpected(credentialId);
        }

        DynamicCredentialStatus storage status = _dynamicCredentialStatus[credentialId];
        if (status.typeId == 0) {
            revert IslamicPassportCertificates__DynamicStatusMissing(credentialId);
        }
        if (status.published) {
            revert IslamicPassportCertificates__PublicationAlreadyPaid(credentialId);
        }
        if (status.publicationFee == 0) {
            revert IslamicPassportCertificates__PublicationFeeUnset(credentialId);
        }
        if (msg.value != status.publicationFee) {
            revert IslamicPassportCertificates__PublicationValueMismatch(status.publicationFee, msg.value);
        }

        status.paidAmount = msg.value;
        status.published = true;

        address payout = status.payoutAddress != address(0) ? status.payoutAddress : cred.issuer;
        (bool ok, ) = payout.call{value: msg.value}("");
        if (!ok) {
            revert IslamicPassportCertificates__PublicationTransferFailed();
        }

        emit DynamicCredentialPublicationPaid(
            credentialId,
            payer,
            msg.value,
            payout,
            unicode"💎 Taxa de publicacao quitada"
        );
    }

    function importLegacyCredential(Credential memory cred) external onlyFacade {
        _credentials[cred.id] = cred;
        _userCredentials[cred.subject].push(cred.id);
        if (cred.id >= _nextCredentialId) {
            _nextCredentialId = cred.id + 1;
        }

        if (!cred.revoked) {
            if (cred.credType == CredentialType.MUSLIM_ATTESTATION) {
                _activeMuslimAttestations[cred.subject] += 1;
            } else if (cred.credType == CredentialType.SHEIK_CERTIFICATE) {
                _activeSheikhCertificates[cred.subject] += 1;
                _addSheikh(cred.subject);
                _firstSheikhAssigned = true;
            }
        }
    }

    function syncSheikhRemoval(address user) external onlyFacade {
        _removeSheikh(user);
    }

    // ======== INTERNAL HELPERS ========

    function _issueCredential(
        CredentialType credType,
        address issuer,
        address subject,
        bytes32 claimHash,
        string memory uri
    ) internal returns (uint256) {
        if (credType == CredentialType.INITIAL && issuer != facade) {
            revert IslamicPassportCertificates__InitialCredentialRestricted();
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

    function _validateSheikhCertificateIssuer(bool issuerIsSuperAdmin) internal view {
        if (!_firstSheikhAssigned && !issuerIsSuperAdmin) {
            revert IslamicPassportCertificates__FirstSheikhNeedsSuperAdmin();
        }
    }

    function _afterCredentialRevoked(Credential storage cred) internal returns (bool subjectLostSheikhStatus) {
        if (cred.credType == CredentialType.MUSLIM_ATTESTATION && _activeMuslimAttestations[cred.subject] > 0) {
            _activeMuslimAttestations[cred.subject] -= 1;
        }

        if (cred.credType == CredentialType.SHEIK_CERTIFICATE && _activeSheikhCertificates[cred.subject] > 0) {
            _activeSheikhCertificates[cred.subject] -= 1;
            if (_activeSheikhCertificates[cred.subject] == 0 && _isSheikh[cred.subject]) {
                _removeSheikh(cred.subject);
                subjectLostSheikhStatus = true;
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

    function _setDynamicPrerequisites(
        DynamicCertificateType storage record,
        uint256[] calldata prerequisiteTypeIds
    ) internal {
        delete record.prerequisiteTypeIds;
        for (uint256 i = 0; i < prerequisiteTypeIds.length; i++) {
            uint256 prereqId = prerequisiteTypeIds[i];
            if (!_dynamicCertificateTypes[prereqId].exists) {
                revert IslamicPassportCertificates__UnknownPrerequisite(prereqId);
            }
            if (prereqId == record.id) {
                revert IslamicPassportCertificates__PrerequisiteCantReferenceSelf(record.id);
            }
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
        if (_activeSheikhCertificates[sheikh] == 0) {
            revert IslamicPassportCertificates__SheikhNotActive(sheikh);
        }
        _dynamicAuthorizedSheikhs[typeId][sheikh] = true;
        record.authorizedSheikhs.push(sheikh);
    }

    function _validateDynamicAudience(DynamicCertificateType storage record, address subject) internal view {
        if (record.audienceRule == DynamicAudienceRule.MUSLIM_ONLY) {
            if (!_hasActiveMuslimAttestation(subject)) {
                revert IslamicPassportCertificates__MuslimAttestationRequired(subject);
            }
        } else if (record.audienceRule == DynamicAudienceRule.SHEIK_ONLY) {
            if (_activeSheikhCertificates[subject] == 0) {
                revert IslamicPassportCertificates__ActiveSheikhRequired(subject);
            }
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
            if (_activeDynamicCertificates[subject][prereqType] == 0) {
                revert IslamicPassportCertificates__MissingPrerequisite(prereqType);
            }
        }
    }

    function _generateCertificateSlug(string memory name) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_normalizeName(name)));
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

    function _migrateFromPreviousManager(address previousManager) internal {
        IIslamicPassportCertificates prev = IIslamicPassportCertificates(previousManager);

        DynamicCertificateType[] memory legacyTypes = prev.listDynamicCertificateTypes();
        uint256 migratedTypes;
        uint256 highestTypeId = _nextDynamicTypeId;

        for (uint256 i = 0; i < legacyTypes.length; i++) {
            DynamicCertificateType memory legacyType = legacyTypes[i];
            uint256 typeId = legacyType.id;

            if (!_dynamicCertificateTypes[typeId].exists) {
                _dynamicTypeIds.push(typeId);
            }

            DynamicCertificateType storage record = _dynamicCertificateTypes[typeId];
            record.id = typeId;
            record.slug = legacyType.slug;
            record.name = legacyType.name;
            record.description = legacyType.description;
            record.audienceRule = legacyType.audienceRule;
            record.category = legacyType.category;
            record.isPublic = legacyType.isPublic;
            record.createdAt = legacyType.createdAt;
            record.createdBy = legacyType.createdBy;
            record.publicationFee = legacyType.publicationFee;
            record.payoutAddress = legacyType.payoutAddress;
            record.exists = legacyType.exists;

            delete record.prerequisiteTypeIds;
            for (uint256 j = 0; j < legacyType.prerequisiteTypeIds.length; j++) {
                record.prerequisiteTypeIds.push(legacyType.prerequisiteTypeIds[j]);
            }

            delete record.authorizedSheikhs;
            for (uint256 j = 0; j < legacyType.authorizedSheikhs.length; j++) {
                address sheikh = legacyType.authorizedSheikhs[j];
                record.authorizedSheikhs.push(sheikh);
                _dynamicAuthorizedSheikhs[typeId][sheikh] = true;
            }

            _dynamicCertificateSlugIndex[legacyType.slug] = typeId;
            migratedTypes += 1;

            if (typeId >= highestTypeId) {
                highestTypeId = typeId + 1;
            }
        }

        if (highestTypeId > _nextDynamicTypeId) {
            _nextDynamicTypeId = highestTypeId;
        }

        uint256 totalCredentialsToMigrate = prev.totalCredentials();
        uint256 migratedCredentials;

        for (uint256 credId = 1; credId <= totalCredentialsToMigrate; credId++) {
            Credential memory cred = prev.getCredential(credId);
            if (cred.id == 0 || _credentials[cred.id].id != 0) {
                continue;
            }

            _credentials[cred.id] = cred;
            _userCredentials[cred.subject].push(cred.id);

            if (cred.id >= _nextCredentialId) {
                _nextCredentialId = cred.id + 1;
            }

            if (!cred.revoked) {
                if (cred.credType == CredentialType.MUSLIM_ATTESTATION) {
                    _activeMuslimAttestations[cred.subject] += 1;
                } else if (cred.credType == CredentialType.SHEIK_CERTIFICATE) {
                    _activeSheikhCertificates[cred.subject] += 1;
                    _addSheikh(cred.subject);
                    _firstSheikhAssigned = true;
                }
            }

            if (cred.credType == CredentialType.DYNAMIC_CERTIFICATE) {
                DynamicCredentialStatus memory status = prev.getDynamicCredentialStatus(cred.id);
                if (status.typeId != 0) {
                    _dynamicCredentialStatus[cred.id] = status;
                    _credentialDynamicType[cred.id] = status.typeId;
                    if (!cred.revoked) {
                        _activeDynamicCertificates[cred.subject][status.typeId] = cred.id;
                    }
                }
            }

            migratedCredentials += 1;
        }

        address[] memory legacySheikhs = prev.listSheikhs();
        for (uint256 i = 0; i < legacySheikhs.length; i++) {
            _addSheikh(legacySheikhs[i]);
        }

        if (_sheikhs.length > 0) {
            _firstSheikhAssigned = true;
        }

        emit CertificatesMigrated(
            previousManager,
            migratedCredentials,
            migratedTypes,
            unicode"📦 IslamicPassport: certificados migrados de gestor anterior"
        );
    }
}
