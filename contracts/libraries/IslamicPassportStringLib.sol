// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library IslamicPassportStringLib {
    function uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
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

    function addressToString(address addr) internal pure returns (string memory) {
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
