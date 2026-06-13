// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IWorld} from "../world/IWorld.sol";

/**
 * @title System
 * @notice Base contract every Nexus system inherits. Provides the redemption-aware
 *         `_msgSender()` (the seam), `_world()` context, an `onlyWorld` guard, and
 *         typed table read/write helpers that proxy through the World's access
 *         control.
 *
 * @dev    THE REDEMPTION SEAM: `World.call` appends the canonical player as the
 *         trailing 20 bytes of calldata (ERC-2771). `_msgSender()` recovers it.
 *         Systems must NEVER read `msg.sender` directly for player attribution.
 */
abstract contract System {
    /// @notice The true player, resolved through the redemption seam.
    function _msgSender() internal view returns (address sender) {
        if (msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    /// @notice The World that routed this call (always the immediate caller).
    function _world() internal view returns (IWorld) {
        return IWorld(msg.sender);
    }

    modifier onlyWorld() {
        require(msg.sender == _worldAddress(), "System: not World");
        _;
    }

    function _worldAddress() internal view virtual returns (address) {
        return msg.sender;
    }

    // ── typed table helpers — proxy to the World's Store (access-controlled) ──
    function _set(bytes32 tableId, bytes32[] memory key, bytes memory s, bytes memory d) internal {
        IWorld(msg.sender).setRecord(tableId, key, s, d);
    }

    function _get(bytes32 tableId, bytes32[] memory key) internal view returns (bytes memory, bytes memory) {
        return IWorld(msg.sender).getRecord(tableId, key);
    }
}
