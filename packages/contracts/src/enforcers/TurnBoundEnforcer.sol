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
        (address turnManager, uint256 roomId) = abi.decode(terms, (address, uint256));
        address current = ITurnManager(turnManager).getCurrent(roomId);
        if (current != delegator) revert NotYourTurn();
    }
}
