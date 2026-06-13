// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CaveatEnforcerBase} from "./CaveatEnforcerBase.sol";
import {ModeCode} from "../delegation/IDelegation.sol";

/**
 * @title TimestampEnforcer
 * @notice Rejects redemption after the delegation's expiry. The design expresses
 *         `expiresAt` in epoch MILLISECONDS (§2.1); EVM works in seconds, so we
 *         convert ms→s here so the rest of the stack speaks one unit.
 * @dev    terms = abi.encode(uint256 expiresAtMs)
 */
contract TimestampEnforcer is CaveatEnforcerBase {
    /// @notice Reverts when block.timestamp is past the delegation expiry.
    error DelegationExpired();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) external view override {
        uint256 expiresAtMs = abi.decode(terms, (uint256));
        uint256 expiresAtSec = expiresAtMs / 1000;
        if (block.timestamp > expiresAtSec) revert DelegationExpired();
    }
}
