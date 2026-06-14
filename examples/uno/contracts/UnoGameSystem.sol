// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {System} from "@nexus/contracts/system/System.sol";
import {IWorld} from "@nexus/contracts/world/IWorld.sol";
import {ITurnManager} from "@nexus/contracts/systems/TurnManager.sol";
import {UnoTable} from "./UnoTable.sol";

/**
 * @title UnoGameSystem
 * @notice A rules-simplified, fully on-chain UNO system following the Nexus
 *         World/System/_msgSender + TurnManager pattern.
 *
 *         Hidden card identities are NOT on-chain — each player's cards are dealt
 *         client-side (a deterministic, seeded hand) and only the public board
 *         state lives in `UnoTable`: the top of the discard pile, the active
 *         color, the CURRENT player's hand count, and the last mover.
 *
 *         Per-player hand COUNTS *are* tracked on-chain (in this contract's own
 *         storage) so the win condition is decided by the chain, not off-chain:
 *         the first player to empty their hand emits `Uno_Won` and the room is
 *         marked finished (no further advance). The pot is then settled to the
 *         winner by the `Pot` contract.
 *
 *         Moves, both turn-enforced on-chain via the TurnManager:
 *           - playCard(roomId, color, number): legal iff it matches the active
 *             color OR the top number. A wild (color==0) sets a new active color
 *             (`number` = chosen color 1..4) and is always legal.
 *           - draw(roomId): the current player draws (their hand count +1) and passes.
 *
 *         Legality is enforced ON-CHAIN against the public top card. Possession of
 *         the played card is attested by the client-derived hand; this contract
 *         trusts the relayed, turn-bound caller for possession.
 */
contract UnoGameSystem is System {
    address public immutable turnManager;
    address public admin;

    // roomId => player => remaining hand count.
    mapping(uint256 => mapping(address => uint8)) public handOf;
    // roomId => winner (address(0) until won).
    mapping(uint256 => address) public winnerOf;

    error Uno_NotYourTurn();
    error Uno_IllegalMove();
    error Uno_NotAdmin();
    error Uno_BadColor();
    error Uno_Finished();
    error Uno_NoCards();

    event Uno_Started(uint256 indexed roomId, uint8 topColor, uint8 topNumber, uint8 handCount);
    event Uno_Played(
        uint256 indexed roomId, address indexed player, uint8 color, uint8 number, uint8 activeColor, uint8 handCount
    );
    event Uno_Drew(uint256 indexed roomId, address indexed player, uint8 handCount);
    event Uno_Won(uint256 indexed roomId, address indexed winner);

    constructor(address _turnManager) {
        turnManager = _turnManager;
        admin = msg.sender;
    }

    function setTrustedRouter(address router) external {
        if (msg.sender != admin) revert Uno_NotAdmin();
        _setTrustedRouter(router);
    }

    /// @notice Seed a room's public board (admin-only, off the redemption path).
    ///         The starting discard top. Does NOT deal hands — call `dealHand` per seat.
    function startRoom(uint256 roomId, uint8 topColor, uint8 topNumber, uint8 handCount) external {
        if (msg.sender != admin) revert Uno_NotAdmin();
        if (topColor < 1 || topColor > 4) revert Uno_BadColor();
        winnerOf[roomId] = address(0);
        IWorld world = IWorld(_worldAddress());
        UnoTable.set(
            world,
            roomId,
            UnoTable.UnoData({
                topColor: topColor,
                topNumber: topNumber,
                activeColor: topColor,
                handCount: handCount,
                lastMover: address(0)
            })
        );
        emit Uno_Started(roomId, topColor, topNumber, handCount);
    }

    /// @notice Deal `count` cards to `player` in `roomId` (admin-only, off the redemption path).
    function dealHand(uint256 roomId, address player, uint8 count) external {
        if (msg.sender != admin) revert Uno_NotAdmin();
        handOf[roomId][player] = count;
    }

    /**
     * @notice Play a card onto the discard pile. Turn- and rule-enforced on-chain.
     * @param color 1..4 for a colored card, or 0 for a WILD (then `number` is the
     *        chosen new active color 1..4).
     * @param number 0..9 for a colored card; for a wild, the chosen color 1..4.
     */
    function playCard(uint256 roomId, uint8 color, uint8 number) external onlyWorld returns (address winner) {
        IWorld world = IWorld(msg.sender);
        address player = _msgSender();

        if (winnerOf[roomId] != address(0)) revert Uno_Finished();
        if (ITurnManager(turnManager).getCurrent(roomId) != player) revert Uno_NotYourTurn();
        if (handOf[roomId][player] == 0) revert Uno_NoCards();

        UnoTable.UnoData memory s = UnoTable.get(world, roomId);

        uint8 newActiveColor;
        uint8 newTopColor;
        uint8 newTopNumber;

        if (color == 0) {
            // WILD: number carries the chosen new active color.
            if (number < 1 || number > 4) revert Uno_BadColor();
            newActiveColor = number;
            newTopColor = 0; // wild marker
            newTopNumber = 0;
        } else {
            if (color > 4) revert Uno_BadColor();
            // Legal iff matches the active color OR the top number.
            bool matchesColor = (color == s.activeColor);
            bool matchesNumber = (s.topColor != 0 && number == s.topNumber);
            if (!matchesColor && !matchesNumber) revert Uno_IllegalMove();
            newActiveColor = color;
            newTopColor = color;
            newTopNumber = number;
        }

        uint8 newHandCount = handOf[roomId][player] - 1;
        handOf[roomId][player] = newHandCount;

        s.topColor = newTopColor;
        s.topNumber = newTopNumber;
        s.activeColor = newActiveColor;
        s.handCount = newHandCount;
        s.lastMover = player;
        UnoTable.set(world, roomId, s);

        emit Uno_Played(roomId, player, newTopColor, newTopNumber, newActiveColor, newHandCount);

        if (newHandCount == 0) {
            winnerOf[roomId] = player;
            emit Uno_Won(roomId, player);
            return player;
        }

        ITurnManager(turnManager).advance(roomId);
        return address(0);
    }

    /// @notice Draw a card (the caller's hand count +1) and pass the turn.
    function draw(uint256 roomId) external onlyWorld {
        IWorld world = IWorld(msg.sender);
        address player = _msgSender();
        if (winnerOf[roomId] != address(0)) revert Uno_Finished();
        if (ITurnManager(turnManager).getCurrent(roomId) != player) revert Uno_NotYourTurn();

        uint8 newCount = handOf[roomId][player] + 1;
        handOf[roomId][player] = newCount;

        UnoTable.UnoData memory s = UnoTable.get(world, roomId);
        s.handCount = newCount;
        s.lastMover = player;
        UnoTable.set(world, roomId, s);
        emit Uno_Drew(roomId, player, newCount);

        ITurnManager(turnManager).advance(roomId);
    }
}
