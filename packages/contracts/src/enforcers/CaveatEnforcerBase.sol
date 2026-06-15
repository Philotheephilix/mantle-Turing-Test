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
    /// @notice executionCalldata was shorter than the ERC-7579 single-execution
    ///         header (target 20 + value 32 = 52 bytes).
    error InvalidExecutionCalldata();

    /// @notice A budget/recipient caveat saw a non-zero native `value`. Nexus
    ///         redemptions are token-only; the manager already rejects non-zero
    ///         value globally, and the spend enforcers reject it again as
    ///         defense-in-depth so an ETH leg can never bypass a USDC cap.
    error NonZeroValueUnsupported();

    /// @dev Reverts unless the execution carries zero native value. Budget and
    ///      recipient enforcers call this so their caps bound the full execution,
    ///      not just the ERC-20 callData leg.
    function _requireNoValue(uint256 value) internal pure {
        if (value != 0) revert NonZeroValueUnsupported();
    }

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
        if (executionCalldata.length < 52) revert InvalidExecutionCalldata();
        target = address(bytes20(executionCalldata[0:20]));
        value = uint256(bytes32(executionCalldata[20:52]));
        callData = executionCalldata[52:];
    }
}
