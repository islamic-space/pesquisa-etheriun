// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Credential, CredentialType, DynamicCredentialStatus, DynamicCertificateType, CreateDynamicCertificateInput} from "../types/IslamicPassportDataTypes.sol";

interface IIslamicPassportCertificates {
    // --- Binding ---
    function bindFacade(address newFacade) external;

    // --- View helpers ---
    function totalCredentials() external view returns (uint256);
    function getCredentialsOf(address user) external view returns (uint256[] memory);
    function getCredential(uint256 id) external view returns (Credential memory);
    function listSheikhs() external view returns (address[] memory);
    function hasActiveMuslimAttestation(address user) external view returns (bool);
    function hasActiveSheikhCertificate(address user) external view returns (bool);
    function isSheikh(address user) external view returns (bool);
    function totalDynamicCertificateTypes() external view returns (uint256);
    function listDynamicCertificateTypes() external view returns (DynamicCertificateType[] memory);
    function getDynamicCertificateType(uint256 typeId) external view returns (DynamicCertificateType memory);
    function getDynamicCertificateAuthorizedSheikhs(uint256 typeId) external view returns (address[] memory);
    function isAuthorizedForDynamicCertificate(uint256 typeId, address sheikh) external view returns (bool);
    function getDynamicCredentialStatus(uint256 credentialId) external view returns (DynamicCredentialStatus memory);
    function getActiveDynamicCredential(address subject, uint256 typeId) external view returns (uint256);

    // --- Credential issuance ---
    function issueInitialCredential(address subject, string calldata optionalUri) external returns (uint256);
    function attestMuslim(
        address issuer,
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external returns (uint256);
    function promoteToSheikh(
        address issuer,
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external returns (uint256 muslimCredId, uint256 sheikhCredId);
    function revokeCredential(
        address caller,
        bool callerIsAdmin,
        uint256 credentialId
    ) external returns (address subject, bool subjectLostSheikhStatus);

    // --- Dynamic certificates ---
    function createDynamicCertificateType(
        address caller,
        CreateDynamicCertificateInput calldata input
    ) external returns (uint256 typeId, bytes32 slug);
    function updateDynamicCertificateType(
        address caller,
        uint256 typeId,
        CreateDynamicCertificateInput calldata input
    ) external returns (bytes32 newSlug);
    function issueDynamicCertificate(
        address caller,
        uint256 typeId,
        address subject,
        bytes32 claimHash,
        string calldata optionalUri
    ) external returns (uint256 credId);
    function payDynamicCredentialPublication(address payer, uint256 credentialId) external payable;

    // --- Legacy migration helpers ---
    function importLegacyCredential(Credential memory cred) external;
    function syncSheikhRemoval(address user) external;
}
