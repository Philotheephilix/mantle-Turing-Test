// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CaveatEnforcerBase} from "./CaveatEnforcerBase.sol";
import {ModeCode} from "../delegation/IDelegation.sol";

/**
 * @title AllowedRecipientsEnforcer
 * @notice Restricts the transfer RECIPIENT to an allowlist — the design's
 *         budget.allowedRecipients (pots/sellers). Each execution must be an ERC-20
 *         transfer/transferFrom of the budget token whose `to` recipient is a member
 *         of the allowlist.
 * @dev    terms = abi.encode(address token, address[] allowedRecipients)
 *         The token address is injected from relayer capabilities — never a literal.
 */
contract AllowedRecipientsEnforcer is CaveatEnforcerBase {
    /// @notice Reverts when the transfer recipient is not in the allowlist
    ///         (or the call is not a transfer of the budget token).
    error RecipientNotAllowed();

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
        // `terms` is the delegator-signed caveat payload replayed by the
        // DelegationManager; it is tamper-evident under the delegation signature, so
        // the (token, allowedRecipients) set is the delegator's intent and cannot be
        // injected by the relayer at redemption time.
        (address token, address[] memory allowedRecipients) = abi.decode(terms, (address, address[]));
        // Split the ERC-7579 single-execution layout (see CaveatEnforcerBase).
        (address target, uint256 value, bytes calldata callData) = _decodeExecution(executionCalldata);
        // Reject any native-value leg: an allowlist on the ERC-20 `to` is meaningless
        // if ETH can be sent elsewhere in the same execution. See
        // CaveatEnforcerBase._requireNoValue.
        _requireNoValue(value);

        if (target != token) revert RecipientNotAllowed();
        if (callData.length < 4) revert RecipientNotAllowed();

        bytes4 sel = bytes4(callData[0:4]);
        address to;
        if (sel == TRANSFER_SELECTOR) {
            // transfer(address to, uint256 amount): the recipient is the 1st ABI word
            // — skip only the 4-byte selector, so bytes [4,36). The low 20 bytes of
            // that 32-byte word are the address. The length guard (4 + 64) ensures the
            // full arg tuple is present before slicing.
            if (callData.length < 4 + 64) revert RecipientNotAllowed();
            to = address(uint160(uint256(bytes32(callData[4:36]))));
        } else if (sel == TRANSFER_FROM_SELECTOR) {
            // transferFrom(address from, address to, uint256 amount): the recipient is
            // the 2nd ABI word — skip the selector + `from`, so bytes [36,68). Guard
            // (4 + 96) covers all three words.
            if (callData.length < 4 + 96) revert RecipientNotAllowed();
            to = address(uint160(uint256(bytes32(callData[36:68]))));
        } else {
            revert RecipientNotAllowed();
        }

        // Allow only if `to` is a member of the signed allowlist; fall through to
        // revert otherwise. Linear scan is fine — allowlists are small (pots/sellers).
        for (uint256 i = 0; i < allowedRecipients.length; i++) {
            if (allowedRecipients[i] == to) return;
        }
        revert RecipientNotAllowed();
    }
}
