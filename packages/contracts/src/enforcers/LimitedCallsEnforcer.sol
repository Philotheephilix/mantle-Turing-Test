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

    /// @dev Used-count keyed on `delegationHash` (not delegator/redeemer): the hash
    ///      uniquely identifies ONE signed delegation, so each delegation gets its own
    ///      independent counter. Keying on the delegator instead would let separate
    ///      delegations share — and prematurely exhaust — a single budget; keying on
    ///      the hash isolates them and makes the cap unforgeable (the hash is bound to
    ///      the signed terms).
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
        // `terms` is the delegator-signed cap replayed by the DelegationManager —
        // tamper-evident under the delegation signature, so the relayer can't inflate
        // `maxActions` per redemption.
        uint256 maxActions = abi.decode(terms, (uint256));
        uint256 used = callsUsed[delegationHash];
        if (used >= maxActions) revert ActionLimitReached();
        // Increment in `beforeHook` (before the downstream execution runs) so that a
        // reverting execution STILL consumes a call. In a turn-based game that is the
        // safe direction: an attacker can't spam retries to grief, and the count can
        // only move forward. afterHook is intentionally not used for the increment.
        callsUsed[delegationHash] = used + 1;
    }
}
