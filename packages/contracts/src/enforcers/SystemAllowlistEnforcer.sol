// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CaveatEnforcerBase} from "./CaveatEnforcerBase.sol";
import {ModeCode} from "../delegation/IDelegation.sol";

/**
 * @title SystemAllowlistEnforcer
 * @notice Constrains which World systems a gameplay delegation may invoke. The
 *         execution must target the World and call `World.call(bytes32 systemId, bytes)`
 *         with a systemId in the allowed set.
 * @dev    terms = abi.encode(address world, bytes32[] allowedSystemIds)
 *         The World entrypoint is `call(bytes32 systemId, bytes callData)`; we
 *         read the first 32-byte arg after the 4-byte selector.
 */
contract SystemAllowlistEnforcer is CaveatEnforcerBase {
    /// @notice Reverts when target != world or the dispatched systemId is not allowed.
    error SystemNotAllowed();

    // selector of World.call(bytes32,bytes)
    bytes4 internal constant WORLD_CALL_SELECTOR = bytes4(keccak256("call(bytes32,bytes)"));

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata executionCalldata,
        bytes32,
        address,
        address
    ) external pure override {
        // `terms` is the delegator-signed caveat payload replayed verbatim by the
        // DelegationManager; the (world, allowed) set reflects the delegator's intent
        // and is tamper-evident under the delegation signature, not relayer-supplied.
        (address world, bytes32[] memory allowed) = abi.decode(terms, (address, bytes32[]));
        // We only need the call target and inner callData here; native value is left
        // to the spend enforcers — gameplay calls carry no token amount to cap.
        (address target,, bytes calldata callData) = _decodeExecution(executionCalldata);

        if (target != world) revert SystemNotAllowed();
        // Need at least the 4-byte selector + one 32-byte arg (the systemId) before
        // we can read it; guard the slice against truncated calldata.
        if (callData.length < 36) revert SystemNotAllowed();
        if (bytes4(callData[0:4]) != WORLD_CALL_SELECTOR) revert SystemNotAllowed();

        // World.call(bytes32 systemId, bytes callData): systemId is the 1st ABI word —
        // skip the 4-byte selector, so bytes [4,36). The 2nd arg (`callData`) is a
        // dynamic `bytes` and is left unconstrained here; the allowlist gates WHICH
        // system runs, not its arguments.
        bytes32 systemId = bytes32(callData[4:36]);
        if (!_contains(allowed, systemId)) revert SystemNotAllowed();
    }

    function _contains(bytes32[] memory set, bytes32 v) internal pure returns (bool) {
        for (uint256 i = 0; i < set.length; i++) {
            if (set[i] == v) return true;
        }
        return false;
    }
}
