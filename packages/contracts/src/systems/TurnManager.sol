// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {System} from "../system/System.sol";

/// @notice Read seam for enforcers (Phase 02 TurnBoundEnforcer reads `getCurrent`).
interface ITurnManager {
    function getCurrent(uint256 roomId) external view returns (address);
    function getTurn(uint256 roomId)
        external
        view
        returns (address current, uint64 deadlineBlock, int8 direction, uint16 turnIndex);
    function advance(uint256 roomId) external;
}

/**
 * @title TurnManager
 * @notice Built-in engine system (design §6.4). Owns turn order, per-turn deadline
 *         blocks, and a permissionless AFK timeout/skip that slashes a deposit
 *         fraction and rewards the reporter — turn enforcement with no off-chain
 *         referee.
 *
 * @dev    Turn state lives in this contract's own storage. Mutating turn calls
 *         (`startTurns`, `advance`, `setDirection`, `postDeposit`) are restricted
 *         to AUTHORIZED callers — the World and writer-granted game systems —
 *         configured by the admin. `timeout` is intentionally permissionless,
 *         gated purely by the on-chain deadline.
 *
 *         `_msgSender()` (the redemption seam) resolves the true player from the
 *         ERC-2771 trailing bytes the World appends, so reporter rewards and
 *         deposits attribute to the real player even when relayed.
 */
contract TurnManager is System {
    uint256 public constant AFK_SLASH_BPS = 1000; // 10% of deposit slashed on timeout

    struct Turn {
        bool active;
        address current;
        uint64 deadlineBlock;
        int8 direction;
        uint16 turnIndex;
        uint64 turnBlocks;
    }

    address public admin;
    // `trustedRouter` (the World; when it calls, appended sender is trusted) is
    // inherited from System and gates the redemption-seam trust.
    mapping(address caller => bool) public authorized;

    mapping(uint256 roomId => Turn) internal _turn;
    mapping(uint256 roomId => address[]) internal _seats;
    mapping(uint256 roomId => mapping(address player => uint256)) internal _seatIndexPlus1;
    mapping(address player => uint256) public deposits;

    error TurnManager_NotActive(uint256 roomId);
    error TurnManager_DeadlineNotPassed(uint256 roomId);
    error TurnManager_AlreadyActive(uint256 roomId);
    error TurnManager_EmptyOrder();
    error TurnManager_NotAdmin();
    error TurnManager_NotAuthorized();

    event TurnManager_Started(uint256 indexed roomId, address[] order, uint64 deadlineBlock);
    event TurnManager_Advanced(uint256 indexed roomId, address current, uint16 turnIndex, uint64 deadlineBlock);
    event TurnManager_TimedOut(uint256 indexed roomId, address skipped, address reporter, uint256 slashAmount);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert TurnManager_NotAdmin();
        _;
    }

    modifier onlyAuthorized() {
        if (!authorized[msg.sender]) revert TurnManager_NotAuthorized();
        _;
    }

    constructor(address _admin) {
        admin = _admin;
        authorized[_admin] = true;
    }

    function authorize(address caller, bool ok) external onlyAdmin {
        authorized[caller] = ok;
    }

    function setTrustedRouter(address router) external onlyAdmin {
        _setTrustedRouter(router);
    }

    /// @dev Reporter resolution: only trust the ERC-2771 appended sender when the
    ///      immediate caller is the trusted router (the World). Otherwise the
    ///      reporter is the direct `msg.sender` (permissionless path).
    function _reporter() internal view returns (address) {
        if (msg.sender == trustedRouter && trustedRouter != address(0)) {
            return _msgSender();
        }
        return msg.sender;
    }

    // ── views (the enforcer seam) ──
    function getCurrent(uint256 roomId) external view returns (address) {
        return _turn[roomId].current;
    }

    function getTurn(uint256 roomId)
        external
        view
        returns (address current, uint64 deadlineBlock, int8 direction, uint16 turnIndex)
    {
        Turn storage t = _turn[roomId];
        return (t.current, t.deadlineBlock, t.direction, t.turnIndex);
    }

    function seatsOf(uint256 roomId) external view returns (address[] memory) {
        return _seats[roomId];
    }

    // ── deposit bookkeeping (funding wires to pots in later phases) ──
    /// @dev `player` is explicit so authorized callers (game systems / the World)
    ///      can post on a player's behalf without relying on the calldata seam.
    function postDeposit(address player, uint256 amount) external onlyAuthorized {
        deposits[player] += amount;
    }

    // ── lifecycle ──
    function startTurns(uint256 roomId, address[] calldata order, uint64 turnBlocks) external onlyAuthorized {
        if (order.length == 0) revert TurnManager_EmptyOrder();
        if (_turn[roomId].active) revert TurnManager_AlreadyActive(roomId);

        delete _seats[roomId];
        for (uint256 i = 0; i < order.length; i++) {
            _seats[roomId].push(order[i]);
            _seatIndexPlus1[roomId][order[i]] = i + 1;
        }

        uint64 deadline = uint64(block.number) + turnBlocks;
        _turn[roomId] = Turn({
            active: true,
            current: order[0],
            deadlineBlock: deadline,
            direction: 1,
            turnIndex: 0,
            turnBlocks: turnBlocks
        });
        emit TurnManager_Started(roomId, order, deadline);
    }

    /// @notice Normal end-of-turn rotation, called by authorized game systems.
    function advance(uint256 roomId) external onlyAuthorized {
        Turn storage t = _turn[roomId];
        if (!t.active) revert TurnManager_NotActive(roomId);
        _rotate(roomId, t);
        emit TurnManager_Advanced(roomId, t.current, t.turnIndex, t.deadlineBlock);
    }

    function setDirection(uint256 roomId, int8 direction) external onlyAuthorized {
        Turn storage t = _turn[roomId];
        if (!t.active) revert TurnManager_NotActive(roomId);
        t.direction = direction;
    }

    /// @notice Permissionless AFK-skip. Gated purely by the on-chain deadline.
    ///         Any caller may report; the reporter (`_msgSender()`) earns the slash.
    function timeout(uint256 roomId) external {
        Turn storage t = _turn[roomId];
        if (!t.active) revert TurnManager_NotActive(roomId);
        if (block.number <= t.deadlineBlock) revert TurnManager_DeadlineNotPassed(roomId);

        address skipped = t.current;
        uint256 dep = deposits[skipped];
        uint256 slash = (dep * AFK_SLASH_BPS) / 10_000;
        address reporter = _reporter();
        if (slash > 0) {
            deposits[skipped] = dep - slash;
            deposits[reporter] += slash; // reward the reporter
        }

        _rotate(roomId, t);
        emit TurnManager_TimedOut(roomId, skipped, reporter, slash);
    }

    function _rotate(uint256 roomId, Turn storage t) internal {
        address[] storage seats = _seats[roomId];
        uint256 n = seats.length;
        uint256 idx = _seatIndexPlus1[roomId][t.current] - 1;
        uint256 next;
        if (t.direction >= 0) {
            next = (idx + 1) % n;
        } else {
            next = (idx + n - 1) % n;
        }
        t.current = seats[next];
        t.turnIndex += 1;
        t.deadlineBlock = uint64(block.number) + t.turnBlocks;
    }
}
