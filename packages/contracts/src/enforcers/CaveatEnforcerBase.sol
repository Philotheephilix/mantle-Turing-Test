// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ICaveatEnforcer, ModeCode} from "../delegation/IDelegation.sol";

/**
 * @title CaveatEnforcerBase
 * @notice Shared base for Nexus caveat enforcers. Implements an empty `afterHook`
 *         (most enforcers only need `beforeHook`) and provides a helper to decode
 *         the `executionCalldata` into (target, value, callData).
 *
 * @dev    `executionCalldata` for a single execution is packed as
 *         abi.encodePacked(target (20 bytes), value (32 bytes), callData (rest)),
 *         which is the ERC-7579 single-execution layout the DelegationManager
 *         passes to enforcers. We decode it via calldata slicing.
 */
abstract contract CaveatEnforcerBase is ICaveatEnforcer {
    /// @inheritdoc ICaveatEnforcer
    function afterHook(
        bytes calldata,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) external virtual override {}

    /// @dev Decode the ERC-7579 single-execution calldata layout.
    function _decodeExecution(bytes calldata executionCalldata)
        internal
        pure
        returns (address target, uint256 value, bytes calldata callData)
    {
        target = address(bytes20(executionCalldata[0:20]));
        value = uint256(bytes32(executionCalldata[20:52]));
        callData = executionCalldata[52:];
    }
}
