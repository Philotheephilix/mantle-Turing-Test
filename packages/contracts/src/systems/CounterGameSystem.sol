// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {System} from "../system/System.sol";
import {IWorld} from "../world/IWorld.sol";
import {CounterTable} from "../codegen/tables/CounterTable.sol";
import {ITurnManager} from "./TurnManager.sol";

/**
 * @title CounterGameSystem
 * @notice A minimal turn-based reference game. Each player, on their turn,
 *         increments a shared room counter by 1; the player who pushes the value
 *         to `target` wins. Exercises the full World + System._msgSender +
 *         TurnManager loop end to end on a real EVM.
 *
 * @dev    The on-turn check here mirrors what the TurnBoundEnforcer enforces at
 *         redemption: the system independently asserts the mover is the current
 *         player, so the game is safe even on the direct (non-redemption) path.
 */
contract CounterGameSystem is System {
    address public immutable turnManager;

    error CounterGame_NotYourTurn();
    error CounterGame_Finished();

    event CounterGame_Moved(uint256 indexed roomId, address indexed player, uint256 value);
    event CounterGame_Won(uint256 indexed roomId, address indexed winner);

    constructor(address _turnManager) {
        turnManager = _turnManager;
    }

    /// @notice Increment the room counter on the caller's turn. Returns the winner
    ///         address once the target is reached (address(0) otherwise).
    function increment(uint256 roomId, uint256 target) external returns (address winner) {
        IWorld world = IWorld(msg.sender); // World routed this call
        address player = _msgSender();

        // turn check (independent of the enforcer, defence in depth)
        if (ITurnManager(turnManager).getCurrent(roomId) != player) revert CounterGame_NotYourTurn();

        CounterTable.CounterData memory c = CounterTable.get(world, roomId);
        if (c.value >= target) revert CounterGame_Finished();

        c.value += 1;
        c.lastMover = player;
        CounterTable.set(world, roomId, c);
        emit CounterGame_Moved(roomId, player, c.value);

        if (c.value >= target) {
            emit CounterGame_Won(roomId, player);
            return player;
        }

        // rotate to the next player (this system is an authorized TurnManager caller)
        ITurnManager(turnManager).advance(roomId);
        return address(0);
    }
}
