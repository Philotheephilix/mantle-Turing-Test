// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CaveatEnforcerBase} from "./CaveatEnforcerBase.sol";
import {ModeCode} from "../delegation/IDelegation.sol";

/**
 * @title PerActionCapEnforcer
 * @notice Caps the spend of a SINGLE budget redemption (one `charge()`), distinct
 *         from the lifetime cap enforced by the stock ERC20TransferAmountEnforcer.
 *         The execution must be an ERC-20 transfer/transferFrom of the budget
 *         token whose amount does not exceed the per-action cap.
 * @dev    terms = abi.encode(address token, uint256 perActionCap)
 *         The token address is injected from relayer capabilities — never a literal.
 */
contract PerActionCapEnforcer is CaveatEnforcerBase {
    /// @notice Reverts when the single-execution transfer exceeds the per-action cap
    ///         (or the call is not a transfer of the budget token).
    error PerActionCapExceeded();

    bytes4 internal constant TRANSFER_SELECTOR = 0xa9059cbb; // transfer(address,uint256)
    bytes4 internal constant TRANSFER_FROM_SELECTOR = 0x23b872dd; // transferFrom(address,address,uint256)

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata executionCalldata,
        bytes32,
        address,
        address
    ) external pure override {
        // `terms` is the caveat payload the DELEGATOR signed when authorizing the
        // delegation; the DelegationManager replays it verbatim into the hook. It is
        // therefore trusted input (tamper-evident under the delegation signature) and
        // NOT something the relayer can forge per-redemption — only the delegator
        // could have chosen this (token, cap) pair.
        (address token, uint256 perActionCap) = abi.decode(terms, (address, uint256));
        // Split the ERC-7579 single-execution layout into (target, value, callData).
        // See CaveatEnforcerBase._decodeExecution for the packed header layout.
        (address target, uint256 value, bytes calldata callData) = _decodeExecution(executionCalldata);
        // Bound the WHOLE execution, not just the ERC-20 leg below: a non-zero native
        // `value` could move funds outside the token amount we cap. See
        // CaveatEnforcerBase._requireNoValue — defense-in-depth so an ETH leg can
        // never slip past a token spend cap.
        _requireNoValue(value);

        if (target != token) revert PerActionCapExceeded();
        if (callData.length < 4) revert PerActionCapExceeded();

        bytes4 sel = bytes4(callData[0:4]);
        uint256 amount;
        if (sel == TRANSFER_SELECTOR) {
            // transfer(address to, uint256 amount): the amount is the 2nd ABI word —
            // skip the 4-byte selector + 32-byte `to`, so the cap value lives at
            // bytes [36,68). The length guard (4 selector + 64 for two words) ensures
            // those bytes exist before we slice, so a truncated call can't underflow.
            if (callData.length < 4 + 64) revert PerActionCapExceeded();
            amount = uint256(bytes32(callData[36:68]));
        } else if (sel == TRANSFER_FROM_SELECTOR) {
            // transferFrom(address from, address to, uint256 amount): the amount is
            // the 3rd ABI word — skip the selector + `from` + `to`, so bytes [68,100).
            // The guard (4 + 96 for three words) protects the slice the same way.
            if (callData.length < 4 + 96) revert PerActionCapExceeded();
            amount = uint256(bytes32(callData[68:100]));
        } else {
            revert PerActionCapExceeded();
        }

        if (amount > perActionCap) revert PerActionCapExceeded();
    }
}
