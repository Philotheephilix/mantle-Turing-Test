// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {System} from "@nexus-contracts/system/System.sol";
import {IWorld} from "@nexus-contracts/world/IWorld.sol";
import {ITurnManager} from "@nexus-contracts/systems/TurnManager.sol";
import {PlayerTable, PropertyTable} from "./MonopolyTables.sol";

interface IRandomnessCoordinator {
    function fastRandom() external returns (uint256 randomWord);
    function dice(uint256 randomWord, uint8 sides, uint8 count) external pure returns (uint8[] memory);
}

/**
 * @title MonopolyGameSystem
 * @notice A rules-simplified but functional onchain Monopoly. Each player, on their
 *         turn, rolls 2d6 via the on-chain RandomnessCoordinator (fast/prevrandao
 *         tier — perfect for a low-stakes board game with no two-block reveal wait),
 *         moves around an N-space board, and lands on a space.
 *
 *         The actual USDC economy (buy a property / pay rent) is settled OFF this
 *         contract through the x402 budget-delegation charge path (the proven Nexus
 *         payment rail): the backend issues a 402 and redeems a budget delegation
 *         that moves real USDC. This system records ownership + cash bookkeeping and
 *         emits the events the indexer/UI project. It follows the exact
 *         World/System/_msgSender + TurnManager pattern of CounterGameSystem.
 */
contract MonopolyGameSystem is System {
    address public immutable turnManager;
    address public immutable randomness;
    address public admin;

    uint8 public constant BOARD_SIZE = 12;
    uint256 public constant START_CASH = 1500e6; // 1500 USDC-denominated play cash (6dp)
    uint256 public constant GO_BONUS = 200e6;

    error Monopoly_NotYourTurn();
    error Monopoly_NotAdmin();
    error Monopoly_NotInitialized();

    event Monopoly_Joined(uint256 indexed roomId, address indexed player, uint256 cash);
    event Monopoly_Rolled(
        uint256 indexed roomId,
        address indexed player,
        uint8 die1,
        uint8 die2,
        uint256 fromPos,
        uint256 toPos,
        bool passedGo
    );
    event Monopoly_Bought(uint256 indexed roomId, address indexed player, uint256 spaceId, uint256 price);
    event Monopoly_RentPaid(
        uint256 indexed roomId, address indexed payer, address indexed owner, uint256 spaceId, uint256 rent
    );

    constructor(address _turnManager, address _randomness) {
        turnManager = _turnManager;
        randomness = _randomness;
        admin = msg.sender;
    }

    function setTrustedRouter(address router) external {
        if (msg.sender != admin) revert Monopoly_NotAdmin();
        _setTrustedRouter(router);
    }

    /// @notice Seat a player into the game with the starting cash. Idempotent-ish:
    ///         overwrites the player's row. Called on the player's own turn (or by
    ///         the admin during setup). Records START_CASH play-money bookkeeping.
    function joinGame(uint256 roomId) external onlyWorld {
        IWorld world = IWorld(msg.sender);
        address player = _msgSender();
        PlayerTable.set(world, roomId, player, PlayerTable.PlayerData({position: 0, cash: START_CASH}));
        emit Monopoly_Joined(roomId, player, START_CASH);
    }

    /// @notice Roll 2d6 on the caller's turn, move around the board, advance the turn.
    ///         Returns (die1, die2, newPosition). Dice come from the on-chain
    ///         RandomnessCoordinator's fast tier mapped through its `dice` helper, so
    ///         the roll is verifiable on-chain (a real RNG event in the receipt).
    function rollAndMove(uint256 roomId) external onlyWorld returns (uint8 die1, uint8 die2, uint256 newPos) {
        IWorld world = IWorld(msg.sender);
        address player = _msgSender();

        if (ITurnManager(turnManager).getCurrent(roomId) != player) revert Monopoly_NotYourTurn();

        PlayerTable.PlayerData memory p = PlayerTable.get(world, roomId, player);
        if (p.cash == 0 && p.position == 0) {
            // auto-seat a player who rolls before an explicit join
            p.cash = START_CASH;
        }

        uint256 word = IRandomnessCoordinator(randomness).fastRandom();
        uint8[] memory rolls = IRandomnessCoordinator(randomness).dice(word, 6, 2);
        die1 = rolls[0];
        die2 = rolls[1];

        uint256 fromPos = p.position;
        uint256 steps = uint256(die1) + uint256(die2);
        uint256 raw = fromPos + steps;
        bool passedGo = raw >= BOARD_SIZE;
        newPos = raw % BOARD_SIZE;

        p.position = newPos;
        if (passedGo) p.cash += GO_BONUS;
        PlayerTable.set(world, roomId, player, p);

        emit Monopoly_Rolled(roomId, player, die1, die2, fromPos, newPos, passedGo);

        ITurnManager(turnManager).advance(roomId);
        return (die1, die2, newPos);
    }

    /// @notice Record a property purchase for `player`. The USDC payment to the bank
    ///         is settled separately via the x402 charge path (the player's budget
    ///         delegation); this writes ownership + debits the player's play-cash
    ///         bookkeeping and emits the event the UI/indexer read.
    ///
    ///         An admin/authority op (the relayer, the game admin): it takes the
    ///         `player` explicitly because it runs OFF the player's turn (after the
    ///         turn has already advanced inside rollAndMove) and is not turn-bound.
    function recordBuy(uint256 roomId, uint256 spaceId, address player, uint256 price, uint256 rent)
        external
        onlyWorld
    {
        IWorld world = IWorld(msg.sender);
        if (_msgSender() != admin) revert Monopoly_NotAdmin();

        PropertyTable.set(
            world, roomId, spaceId, PropertyTable.PropertyData({owner: player, price: price, rent: rent})
        );

        PlayerTable.PlayerData memory p = PlayerTable.get(world, roomId, player);
        if (p.cash >= price) p.cash -= price;
        PlayerTable.set(world, roomId, player, p);

        emit Monopoly_Bought(roomId, player, spaceId, price);
    }

    /// @notice Record a rent payment by `player` to the space owner. USDC settled via
    ///         x402; this moves play-cash bookkeeping and emits the event. Admin op.
    function recordRent(uint256 roomId, uint256 spaceId, address player) external onlyWorld {
        IWorld world = IWorld(msg.sender);
        if (_msgSender() != admin) revert Monopoly_NotAdmin();

        PropertyTable.PropertyData memory prop = PropertyTable.get(world, roomId, spaceId);
        if (prop.owner == address(0) || prop.owner == player) return;

        PlayerTable.PlayerData memory payer = PlayerTable.get(world, roomId, player);
        if (payer.cash >= prop.rent) payer.cash -= prop.rent;
        PlayerTable.set(world, roomId, player, payer);

        PlayerTable.PlayerData memory owner = PlayerTable.get(world, roomId, prop.owner);
        owner.cash += prop.rent;
        PlayerTable.set(world, roomId, prop.owner, owner);

        emit Monopoly_RentPaid(roomId, player, prop.owner, spaceId, prop.rent);
    }

    /// @notice Read-only helpers for the off-chain server/UI (read via the World).
    function positionOf(uint256 roomId, address player) external view returns (uint256) {
        return PlayerTable.get(IWorld(trustedRouter), roomId, player).position;
    }

    function cashOf(uint256 roomId, address player) external view returns (uint256) {
        return PlayerTable.get(IWorld(trustedRouter), roomId, player).cash;
    }

    function ownerOf(uint256 roomId, uint256 spaceId) external view returns (address) {
        return PropertyTable.get(IWorld(trustedRouter), roomId, spaceId).owner;
    }
}
