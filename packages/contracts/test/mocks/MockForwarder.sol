// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {World} from "../../src/world/World.sol";

/**
 * @notice Simulates ERC-7710 redemption: calls World.call and appends an
 *         `onBehalfOf` player as trailing 20 bytes (ERC-2771), exactly as the
 *         canonical DelegationManager forwarder will at runtime.
 */
contract MockForwarder {
    World public immutable world;

    constructor(World _world) {
        world = _world;
    }

    /// @dev Build calldata for World.call(systemId, callData) then append `onBehalfOf`.
    function redeem(bytes32 systemId, bytes calldata callData, address onBehalfOf)
        external
        returns (bytes memory)
    {
        bytes memory base = abi.encodeWithSignature("call(bytes32,bytes)", systemId, callData);
        bytes memory withSender = abi.encodePacked(base, onBehalfOf);
        (bool ok, bytes memory ret) = address(world).call(withSender);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        // ret is the abi-encoded `bytes` return of World.call; decode one layer
        return abi.decode(ret, (bytes));
    }
}
