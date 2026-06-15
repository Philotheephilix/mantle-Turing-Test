// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CaveatEnforcerBase} from "./CaveatEnforcerBase.sol";
import {ModeCode} from "../delegation/IDelegation.sol";

/**
 * @title ERC20TransferAmountEnforcer
 * @notice Enforces a LIFETIME (cumulative) spend cap across all redemptions of a
 *         single delegation — the design's budget.totalCap. Each execution must be
 *         an ERC-20 transfer/transferFrom of the budget token; the running total of
 *         transferred amounts may never exceed the lifetime cap.
 *         Stateful: keys the cumulative spend on `delegationHash` so two delegations
 *         never interfere. Increments in `beforeHook` (like LimitedCallsEnforcer) so
 *         a downstream revert rolls the increment back atomically.
 * @dev    terms = abi.encode(address token, uint256 lifetimeCap)
 *         The token address is injected from relayer capabilities — never a literal.
 */
contract ERC20TransferAmountEnforcer is CaveatEnforcerBase {
    /// @notice Reverts when cumulative transfers exceed the lifetime cap
    ///         (or the call is not a transfer of the budget token).
    error ERC20TransferAmountExceeded();

    bytes4 internal constant TRANSFER_SELECTOR = 0xa9059cbb; // transfer(address,uint256)
    bytes4 internal constant TRANSFER_FROM_SELECTOR = 0x23b872dd; // transferFrom(address,address,uint256)

    mapping(bytes32 delegationHash => uint256 spent) public spentMap;

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address,
        address
    ) external override {
        (address token, uint256 lifetimeCap) = abi.decode(terms, (address, uint256));
        (address target, uint256 value, bytes calldata callData) = _decodeExecution(executionCalldata);
        _requireNoValue(value);

        if (target != token) revert ERC20TransferAmountExceeded();
        if (callData.length < 4) revert ERC20TransferAmountExceeded();

        bytes4 sel = bytes4(callData[0:4]);
        uint256 amount;
        if (sel == TRANSFER_SELECTOR) {
            // transfer(address to, uint256 amount): amount is 2nd arg
            if (callData.length < 4 + 64) revert ERC20TransferAmountExceeded();
            amount = uint256(bytes32(callData[36:68]));
        } else if (sel == TRANSFER_FROM_SELECTOR) {
            // transferFrom(address from, address to, uint256 amount): amount is 3rd arg
            if (callData.length < 4 + 96) revert ERC20TransferAmountExceeded();
            amount = uint256(bytes32(callData[68:100]));
        } else {
            revert ERC20TransferAmountExceeded();
        }

        uint256 newSpent = spentMap[delegationHash] + amount;
        if (newSpent > lifetimeCap) revert ERC20TransferAmountExceeded();
        spentMap[delegationHash] = newSpent;
    }
}
