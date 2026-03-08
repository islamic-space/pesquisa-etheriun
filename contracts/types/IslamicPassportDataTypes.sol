// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IslamicPassportDataTypes
/// @notice Shared enums and structs used across the Islamic Passport contracts.

enum CredentialType {
    INITIAL,
    MUSLIM_ATTESTATION,
    SHEIK_CERTIFICATE,
    DYNAMIC_CERTIFICATE,
    SUFI_CERTIFICATE,
    DONATION_CERTIFICATE
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

enum PrayerLocationType {
    MESQUITA,
    MUSALLAH,
    ZAWIYA,
    OUTRO
}

struct Credential {
    uint256 id;
    CredentialType credType;
    address issuer;
    address subject;
    bytes32 claimHash;
    string uri;
    uint256 issuedAt;
    uint16 validityMonths;
    bool revoked;
    uint256 revokedAt;
}

struct DynamicCredentialStatus {
    uint256 typeId;
    bool published;
    uint256 publicationFee;
    address payoutAddress;
    uint256 paidAmount;
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
    uint16 defaultValidityMonths;
    address[] authorizedSheikhs;
    bool exists;
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
    uint16 defaultValidityMonths;
    address[] authorizedSheikhs;
}

struct PrayerLocationInput {
    string name;
    PrayerLocationType locationType;
    string geoReference;
    bool sufiFriendly;
    string sufiOrder;
}

struct PrayerLocation {
    uint256 id;
    string name;
    PrayerLocationType locationType;
    string geoReference;
    bool sufiFriendly;
    string sufiOrder;
    uint256 createdAt;
    address createdBy;
    bool exists;
}

struct PrayerLocationView {
    PrayerLocation core;
    address[] sheikhs;
    uint256 memberCount;
}

struct LocationMembership {
    uint256 locationId;
    uint256 joinedAt;
    address addedBy;
}

struct ManageLocationRequest {
    bool createNewLocation;
    uint256 existingLocationId;
    PrayerLocationInput locationInput;
}

enum DonationBeneficiaryType {
    INDIVIDUO,
    MESQUITA,
    SHEIK
}

struct DonationPayload {
    DonationBeneficiaryType beneficiaryType;
    address beneficiaryAddress;
    uint256 locationId;
    bool isZakat;
    uint256 amount;
}

interface IIslamicPassportEvents {
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

    event SufiCertified(
        uint256 indexed credentialId,
        address indexed issuer,
        address indexed subject,
        string emojiLog
    );

    event DonationRegistered(
        uint256 indexed credentialId,
        address indexed donor,
        uint256 amount,
        string note,
        string emojiLog
    );
}
