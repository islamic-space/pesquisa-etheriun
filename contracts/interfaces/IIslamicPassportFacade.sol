// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IIslamicPassportFacade {
    function profileExists(address user) external view returns (bool);

    function canActAsAttestedSheikh(address user) external view returns (bool);

    function hasRole(bytes32 role, address account) external view returns (bool);

    function notifySheikhPromotion(address subject) external;

    function notifySheikhDemotion(address subject) external;
}
