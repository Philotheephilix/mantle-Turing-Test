// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {CaveatEnforcerBase} from "./CaveatEnforcerBase.sol";
import {ModeCode} from "../delegation/IDelegation.sol";
import {ITurnManager} from "../systems/TurnManager.sol";

/**
 * @title TurnBoundEnforcer
 * @notice Allows redemption only when `delegator` is the player whose turn it is.
 *         Reads the live current player from the TurnManager system.
 * @dev    terms = abi.encode(address turnManager, uint256 roomId)
 */
contract TurnBoundEnforcer is CaveatEnforcerBase {
    /// @notice Reverts when the redeeming delegator is not the current player.
    error NotYourTurn();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address delegator,
        address
    ) external view override {
        // `terms` is the delegator-signed caveat payload replayed by the
        // DelegationManager; (turnManager, roomId) is the delegator's intent and is
        // tamper-evident under the delegation signature — the relayer cannot point us
        // at a different TurnManager or room to dodge the turn check.
        (address turnManager, uint256 roomId) = abi.decode(terms, (address, uint256));
        // Read the LIVE current player at redemption time (not a snapshot baked into
        // terms): turn order advances on-chain, so the gate must reflect present state.
        address current = ITurnManager(turnManager).getCurrent(roomId);
        // `delegator` is supplied by the DelegationManager (the authenticated grantor
        // of this delegation), so comparing it to the live current player enforces
        // "redeem only on your own turn".
        if (current != delegator) revert NotYourTurn();
    }
}
