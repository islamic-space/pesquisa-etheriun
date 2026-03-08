// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PrayerLocation, PrayerLocationView, PrayerLocationInput, ManageLocationRequest, LocationMembership, DonationPayload} from "../types/IslamicPassportDataTypes.sol";

interface IIslamicPrayerRegistry {
    // --- Binding ---
    function bindFacade(address newFacade) external;

    // --- Read helpers ---
    function totalLocations() external view returns (uint256);
    function listLocationIds() external view returns (uint256[] memory);
    function getLocation(uint256 locationId) external view returns (PrayerLocationView memory);
    function getLocationCore(uint256 locationId) external view returns (PrayerLocation memory);
    function getLocationSheikhs(uint256 locationId) external view returns (address[] memory);
    function getSheikhLocation(address sheikh) external view returns (uint256);
    function getMemberLocation(address member) external view returns (LocationMembership memory);
    function hasPendingMembershipRequest(address member) external view returns (bool);

    // --- Mutations (facade only) ---
    function upsertLocation(address operator, ManageLocationRequest calldata request) external returns (uint256 locationId);
    function assignSheikhToLocation(
        address operator,
        address sheikh,
        ManageLocationRequest calldata request
    ) external returns (uint256 locationId, uint256 previousLocationId);
    function transferSheikh(
        address operator,
        address sheikh,
        uint256 targetLocationId
    ) external returns (uint256 previousLocationId);
    function removeSheikhFromLocation(address operator, address sheikh) external returns (uint256 previousLocationId);

    function submitMembershipRequest(address requester, uint256 locationId) external;
    function cancelMembershipRequest(address requester) external returns (uint256 locationId);
    function approveMembershipRequest(
        address operator,
        address requester,
        uint256 locationId
    ) external returns (LocationMembership memory membershipSnapshot);
    function grantMembership(
        address operator,
        address member,
        uint256 locationId
    ) external returns (LocationMembership memory membershipSnapshot);
    function removeMember(address operator, address member) external returns (uint256 previousLocationId);

    function recordDonation(
        address donor,
        DonationPayload calldata payload,
        string calldata note
    ) external returns (uint256 locationId, address beneficiaryWallet);
}
