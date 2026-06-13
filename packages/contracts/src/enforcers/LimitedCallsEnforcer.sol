// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CaveatEnforcerBase} from "./CaveatEnforcerBase.sol";
import {ModeCode} from "../delegation/IDelegation.sol";

/**
 * @title LimitedCallsEnforcer
 * @notice Caps the total number of redemptions over a delegation's lifetime.
 *         Stateful: keys the used-count on `delegationHash` so two delegations
 *         never interfere. Increments in `beforeHook` (a reverting downstream
 *         execution still consumes a call — griefing resistance for turn games).
 * @dev    terms = abi.encode(uint256 maxActions)
 */
contract LimitedCallsEnforcer is CaveatEnforcerBase {
    /// @notice Reverts once the delegation has been redeemed `maxActions` times.
    error ActionLimitReached();

    mapping(bytes32 delegationHash => uint256 used) public callsUsed;

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32 delegationHash,
        address,
        address
    ) external override {
        uint256 maxActions = abi.decode(terms, (uint256));
        uint256 used = callsUsed[delegationHash];
        if (used >= maxActions) revert ActionLimitReached();
        callsUsed[delegationHash] = used + 1;
    }
}
