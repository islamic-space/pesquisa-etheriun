// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IIslamicPrayerRegistry} from "./interfaces/IIslamicPrayerRegistry.sol";
import {
    PrayerLocation,
    PrayerLocationView,
    PrayerLocationInput,
    ManageLocationRequest,
    LocationMembership,
    DonationPayload,
    DonationBeneficiaryType
} from "./types/IslamicPassportDataTypes.sol";

/// @title IslamicPrayerRegistry
/// @notice Mantém os registros de locais de oração, atribuição de sheiks e filiação de fiéis.
contract IslamicPrayerRegistry is IIslamicPrayerRegistry {
    error IslamicPrayerRegistry__FacadeAlreadyBound();
    error IslamicPrayerRegistry__InvalidFacade();
    error IslamicPrayerRegistry__OnlyFacade(address caller);
    error IslamicPrayerRegistry__LocationMissing(uint256 locationId);
    error IslamicPrayerRegistry__InvalidLocationName();
    error IslamicPrayerRegistry__SheikhAlreadyAssigned(address sheikh);
    error IslamicPrayerRegistry__SheikhNotAssigned(address sheikh);
    error IslamicPrayerRegistry__OperatorNotSheikh(address operator, uint256 locationId);
    error IslamicPrayerRegistry__MemberAlreadyAssigned(address member);
    error IslamicPrayerRegistry__MemberNotFound(address member);
    error IslamicPrayerRegistry__PendingRequestMissing(address requester);
    error IslamicPrayerRegistry__PendingRequestForDifferentLocation(address requester, uint256 expectedLocationId);
    error IslamicPrayerRegistry__DonationMismatch(uint256 declaredAmount, uint256 valueReceived);
    error IslamicPrayerRegistry__DuplicateMembershipRequest(address requester);

    event PrayerLocationSaved(uint256 indexed locationId, address indexed operator, string emojiLog);
    event SheikhAssignedToLocation(uint256 indexed locationId, address indexed sheikh, address indexed operator, string emojiLog);
    event SheikhTransferred(uint256 indexed fromLocationId, uint256 indexed toLocationId, address indexed sheikh, string emojiLog);
    event SheikhRemoved(uint256 indexed locationId, address indexed sheikh, address indexed operator, string emojiLog);
    event MembershipRequested(address indexed requester, uint256 indexed locationId, string emojiLog);
    event MembershipCancelled(address indexed requester, uint256 indexed locationId, string emojiLog);
    event MembershipApproved(address indexed requester, uint256 indexed locationId, address indexed operator, string emojiLog);
    event MembershipGranted(address indexed member, uint256 indexed locationId, address indexed operator, string emojiLog);
    event MembershipRemoved(address indexed member, uint256 indexed locationId, address indexed operator, string emojiLog);
    event DonationRecorded(
        address indexed donor,
        uint256 indexed locationId,
        DonationPayload payload,
        string note,
        string emojiLog
    );

    address public facade;

    uint256 private _nextLocationId = 1;
    mapping(uint256 => PrayerLocation) private _locations;
    uint256[] private _locationIds;

    mapping(uint256 => address[]) private _locationSheikhs;
    mapping(address => uint256) private _sheikhLocation;
    mapping(uint256 => mapping(address => bool)) private _locationSheikhIndex;

    struct PendingMembership {
        uint256 locationId;
        uint256 requestedAt;
        bool exists;
    }

    mapping(address => LocationMembership) private _memberships;
    mapping(address => PendingMembership) private _pendingMemberships;
    mapping(uint256 => uint256) private _locationMemberCount;

    modifier onlyFacade() {
        if (msg.sender != facade) {
            revert IslamicPrayerRegistry__OnlyFacade(msg.sender);
        }
        _;
    }

    function bindFacade(address newFacade) external {
        if (facade != address(0)) {
            revert IslamicPrayerRegistry__FacadeAlreadyBound();
        }
        if (newFacade == address(0)) {
            revert IslamicPrayerRegistry__InvalidFacade();
        }
        if (msg.sender != newFacade) {
            revert IslamicPrayerRegistry__OnlyFacade(msg.sender);
        }
        facade = newFacade;
    }

    // --- View helpers ---

    function totalLocations() external view override returns (uint256) {
        return _locationIds.length;
    }

    function listLocationIds() external view override returns (uint256[] memory) {
        return _locationIds;
    }

    function getLocation(uint256 locationId) external view override returns (PrayerLocationView memory view_) {
        PrayerLocation storage record = _locations[locationId];
        if (!record.exists) {
            revert IslamicPrayerRegistry__LocationMissing(locationId);
        }
        address[] memory sheikhs = _locationSheikhs[locationId];
        view_ = PrayerLocationView({core: record, sheikhs: sheikhs, memberCount: _locationMemberCount[locationId]});
    }

    function getLocationCore(uint256 locationId) external view override returns (PrayerLocation memory) {
        PrayerLocation storage record = _locations[locationId];
        if (!record.exists) {
            revert IslamicPrayerRegistry__LocationMissing(locationId);
        }
        return record;
    }

    function getLocationSheikhs(uint256 locationId) external view override returns (address[] memory) {
        PrayerLocation storage record = _locations[locationId];
        if (!record.exists) {
            revert IslamicPrayerRegistry__LocationMissing(locationId);
        }
        return _locationSheikhs[locationId];
    }

    function getSheikhLocation(address sheikh) external view override returns (uint256) {
        return _sheikhLocation[sheikh];
    }

    function getMemberLocation(address member) external view override returns (LocationMembership memory) {
        return _memberships[member];
    }

    function hasPendingMembershipRequest(address member) external view override returns (bool) {
        return _pendingMemberships[member].exists;
    }

    // --- Mutations ---

    function upsertLocation(address operator, ManageLocationRequest calldata request)
        public
        override
        onlyFacade
        returns (uint256 locationId)
    {
        if (request.createNewLocation) {
            locationId = _createLocation(operator, request.locationInput);
        } else {
            locationId = request.existingLocationId;
            _updateLocation(operator, locationId, request.locationInput);
        }
        return locationId;
    }

    function assignSheikhToLocation(
        address operator,
        address sheikh,
        ManageLocationRequest calldata request
    ) external override onlyFacade returns (uint256 locationId, uint256 previousLocationId) {
        require(sheikh != address(0), "IslamicPrayerRegistry: sheikh invalido");
        previousLocationId = _sheikhLocation[sheikh];
        if (previousLocationId != 0) {
            revert IslamicPrayerRegistry__SheikhAlreadyAssigned(sheikh);
        }
        locationId = upsertLocation(operator, request);
        _assignSheikh(locationId, sheikh, operator);
    }

    function transferSheikh(
        address operator,
        address sheikh,
        uint256 targetLocationId
    ) external override onlyFacade returns (uint256 previousLocationId) {
        require(sheikh != address(0), "IslamicPrayerRegistry: sheikh invalido");
        PrayerLocation storage target = _locations[targetLocationId];
        if (!target.exists) {
            revert IslamicPrayerRegistry__LocationMissing(targetLocationId);
        }
        previousLocationId = _sheikhLocation[sheikh];
        if (previousLocationId == 0) {
            revert IslamicPrayerRegistry__SheikhNotAssigned(sheikh);
        }
        _removeSheikh(previousLocationId, sheikh, operator);
        _assignSheikh(targetLocationId, sheikh, operator);
        emit SheikhTransferred(previousLocationId, targetLocationId, sheikh, unicode"🔄 Sheikh transferido");
    }

    function removeSheikhFromLocation(address operator, address sheikh)
        external
        override
        onlyFacade
        returns (uint256 previousLocationId)
    {
        previousLocationId = _sheikhLocation[sheikh];
        if (previousLocationId == 0) {
            revert IslamicPrayerRegistry__SheikhNotAssigned(sheikh);
        }
        _removeSheikh(previousLocationId, sheikh, operator);
    }

    function submitMembershipRequest(address requester, uint256 locationId) external override onlyFacade {
        PrayerLocation storage record = _locations[locationId];
        if (!record.exists) {
            revert IslamicPrayerRegistry__LocationMissing(locationId);
        }
        if (_memberships[requester].locationId != 0) {
            revert IslamicPrayerRegistry__MemberAlreadyAssigned(requester);
        }
        PendingMembership storage pending = _pendingMemberships[requester];
        if (pending.exists) {
            revert IslamicPrayerRegistry__DuplicateMembershipRequest(requester);
        }
        pending.locationId = locationId;
        pending.requestedAt = block.timestamp;
        pending.exists = true;
        emit MembershipRequested(requester, locationId, unicode"📨 Pedido de ingresso enviado");
    }

    function cancelMembershipRequest(address requester) external override onlyFacade returns (uint256 locationId) {
        PendingMembership storage pending = _pendingMemberships[requester];
        if (!pending.exists) {
            revert IslamicPrayerRegistry__PendingRequestMissing(requester);
        }
        locationId = pending.locationId;
        delete _pendingMemberships[requester];
        emit MembershipCancelled(requester, locationId, unicode"❌ Pedido de ingresso cancelado");
    }

    function approveMembershipRequest(
        address operator,
        address requester,
        uint256 locationId
    ) external override onlyFacade returns (LocationMembership memory membershipSnapshot) {
        PendingMembership storage pending = _pendingMemberships[requester];
        if (!pending.exists) {
            revert IslamicPrayerRegistry__PendingRequestMissing(requester);
        }
        if (pending.locationId != locationId) {
            revert IslamicPrayerRegistry__PendingRequestForDifferentLocation(requester, locationId);
        }
        if (!_locationSheikhIndex[locationId][operator]) {
            revert IslamicPrayerRegistry__OperatorNotSheikh(operator, locationId);
        }
        membershipSnapshot = LocationMembership({locationId: locationId, joinedAt: block.timestamp, addedBy: operator});
        _memberships[requester] = membershipSnapshot;
        _locationMemberCount[locationId] += 1;
        delete _pendingMemberships[requester];
        emit MembershipApproved(requester, locationId, operator, unicode"🤝 Membro aprovado");
    }

    function grantMembership(
        address operator,
        address member,
        uint256 locationId
    ) external override onlyFacade returns (LocationMembership memory membershipSnapshot) {
        PrayerLocation storage record = _locations[locationId];
        if (!record.exists) {
            revert IslamicPrayerRegistry__LocationMissing(locationId);
        }
        if (!_locationSheikhIndex[locationId][operator]) {
            revert IslamicPrayerRegistry__OperatorNotSheikh(operator, locationId);
        }
        if (_memberships[member].locationId != 0) {
            revert IslamicPrayerRegistry__MemberAlreadyAssigned(member);
        }
        if (_pendingMemberships[member].exists) {
            delete _pendingMemberships[member];
        }
        membershipSnapshot = LocationMembership({locationId: locationId, joinedAt: block.timestamp, addedBy: operator});
        _memberships[member] = membershipSnapshot;
        _locationMemberCount[locationId] += 1;
        emit MembershipGranted(member, locationId, operator, unicode"👐 Membro adicionado diretamente");
    }

    function removeMember(address operator, address member)
        external
        override
        onlyFacade
        returns (uint256 previousLocationId)
    {
        LocationMembership storage membership = _memberships[member];
        if (membership.locationId == 0) {
            revert IslamicPrayerRegistry__MemberNotFound(member);
        }
        previousLocationId = membership.locationId;
        if (!_locationSheikhIndex[previousLocationId][operator]) {
            revert IslamicPrayerRegistry__OperatorNotSheikh(operator, previousLocationId);
        }
        delete _memberships[member];
        if (_locationMemberCount[previousLocationId] > 0) {
            _locationMemberCount[previousLocationId] -= 1;
        }
        emit MembershipRemoved(member, previousLocationId, operator, unicode"🧾 Membro removido");
    }

    function recordDonation(
        address donor,
        DonationPayload calldata payload,
        string calldata note
    ) external override onlyFacade returns (uint256 locationId, address beneficiaryWallet) {
        if (payload.amount == 0) {
            revert IslamicPrayerRegistry__DonationMismatch(payload.amount, 0);
        }
        if (payload.beneficiaryType == DonationBeneficiaryType.MESQUITA) {
            locationId = payload.locationId;
            PrayerLocation storage record = _locations[locationId];
            if (!record.exists) {
                revert IslamicPrayerRegistry__LocationMissing(locationId);
            }
            address[] storage sheikhs = _locationSheikhs[locationId];
            beneficiaryWallet = sheikhs.length > 0 ? sheikhs[0] : record.createdBy;
        } else {
            beneficiaryWallet = payload.beneficiaryAddress;
            locationId = payload.locationId;
        }
        emit DonationRecorded(donor, locationId, payload, note, unicode"💝 Doação registrada");
    }

    // --- Internal helpers ---

    function _createLocation(address operator, PrayerLocationInput calldata input) internal returns (uint256 locationId) {
        if (bytes(input.name).length < 3) {
            revert IslamicPrayerRegistry__InvalidLocationName();
        }
        locationId = _nextLocationId++;
        PrayerLocation storage record = _locations[locationId];
        record.id = locationId;
        _persistLocation(record, operator, input);
        _locationIds.push(locationId);
        emit PrayerLocationSaved(locationId, operator, unicode"🕌 Local criado/atualizado");
    }

    function _updateLocation(address operator, uint256 locationId, PrayerLocationInput calldata input) internal {
        PrayerLocation storage record = _locations[locationId];
        if (!record.exists) {
            revert IslamicPrayerRegistry__LocationMissing(locationId);
        }
        _persistLocation(record, operator, input);
        emit PrayerLocationSaved(locationId, operator, unicode"📝 Local atualizado");
    }

    function _persistLocation(
        PrayerLocation storage record,
        address operator,
        PrayerLocationInput calldata input
    ) internal {
        record.name = input.name;
        record.locationType = input.locationType;
        record.geoReference = input.geoReference;
        record.sufiFriendly = input.sufiFriendly;
        record.sufiOrder = input.sufiOrder;
        if (!record.exists) {
            record.createdAt = block.timestamp;
            record.createdBy = operator;
            record.exists = true;
        }
    }

    function _assignSheikh(uint256 locationId, address sheikh, address operator) internal {
        PrayerLocation storage record = _locations[locationId];
        if (!record.exists) {
            revert IslamicPrayerRegistry__LocationMissing(locationId);
        }
        _locationSheikhs[locationId].push(sheikh);
        _locationSheikhIndex[locationId][sheikh] = true;
        _sheikhLocation[sheikh] = locationId;
        emit SheikhAssignedToLocation(locationId, sheikh, operator, unicode"👳 Sheikh associado");
    }

    function _removeSheikh(uint256 locationId, address sheikh, address operator) internal {
        PrayerLocation storage record = _locations[locationId];
        if (!record.exists) {
            revert IslamicPrayerRegistry__LocationMissing(locationId);
        }
        address[] storage sheikhs = _locationSheikhs[locationId];
        bool removed;
        for (uint256 i = 0; i < sheikhs.length; i++) {
            if (sheikhs[i] == sheikh) {
                sheikhs[i] = sheikhs[sheikhs.length - 1];
                sheikhs.pop();
                removed = true;
                break;
            }
        }
        if (!removed) {
            revert IslamicPrayerRegistry__SheikhNotAssigned(sheikh);
        }
        delete _locationSheikhIndex[locationId][sheikh];
        delete _sheikhLocation[sheikh];
        emit SheikhRemoved(locationId, sheikh, operator, unicode"⚠️ Sheikh removido");
    }
}
