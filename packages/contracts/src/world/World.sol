// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IWorld} from "./IWorld.sol";

/**
 * @title World
 * @notice The root contract of a Nexus game: a minimal ECS store with a table
 *         registry, a system registry, a system-call router, and per-table
 *         access control. Every mutation emits a canonical `Store_*` event so an
 *         off-chain indexer can project state without re-reading storage.
 *
 * @dev    THE REDEMPTION SEAM (Phase 01 §4.7): a move can arrive routed through
 *         an ERC-7710 redemption via the trusted forwarder (the canonical
 *         MetaMask DelegationManager). When `msg.sender == trustedForwarder`,
 *         `call` resolves the on-behalf-of player from the trailing 20 bytes of
 *         calldata (ERC-2771 style) and appends it to the system callData so the
 *         `System` base recovers the true player via `_msgSender()`.
 */
contract World is IWorld, ReentrancyGuard {
    bytes32 public constant WORLD_VERSION = bytes32("nexus.world.v1");

    // ── registries ──
    struct TableSchema {
        bool registered;
        bytes32 keySchema;
        bytes32 valueSchema;
    }

    mapping(bytes32 tableId => TableSchema) internal _tables;
    mapping(bytes32 systemId => address) internal _systems;
    mapping(bytes32 systemId => bool) internal _systemPublic;

    // ── record store: tableId => keyHash => packed record ──
    mapping(bytes32 tableId => mapping(bytes32 keyHash => bytes)) internal _staticStore;
    mapping(bytes32 tableId => mapping(bytes32 keyHash => bytes)) internal _dynamicStore;
    mapping(bytes32 tableId => mapping(bytes32 keyHash => bool)) internal _exists;

    // ── access control ──
    address public owner;
    address public trustedForwarder;
    mapping(bytes32 tableId => mapping(address writer => bool)) public canWrite;

    // ── errors ──
    error World_NotOwner();
    error World_TableNotFound(bytes32 tableId);
    error World_TableExists(bytes32 tableId);
    error World_SystemNotFound(bytes32 systemId);
    error World_AccessDenied(bytes32 tableId, address caller);
    error World_RecordNotFound(bytes32 tableId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert World_NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit World_HelloWorld(WORLD_VERSION);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Access-control admin
    // ─────────────────────────────────────────────────────────────────────────

    function setTrustedForwarder(address forwarder) external onlyOwner {
        trustedForwarder = forwarder;
    }

    function grantWriteAccess(bytes32 tableId, address writer) external onlyOwner {
        if (!_tables[tableId].registered) revert World_TableNotFound(tableId);
        canWrite[tableId][writer] = true;
    }

    function revokeWriteAccess(bytes32 tableId, address writer) external onlyOwner {
        canWrite[tableId][writer] = false;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Registries
    // ─────────────────────────────────────────────────────────────────────────

    function registerTable(
        bytes32 tableId,
        bytes32 keySchema,
        bytes32 valueSchema,
        string[] calldata fieldNames
    ) external onlyOwner {
        if (_tables[tableId].registered) revert World_TableExists(tableId);
        _tables[tableId] = TableSchema({registered: true, keySchema: keySchema, valueSchema: valueSchema});
        emit World_TableRegistered(tableId, keySchema, valueSchema, fieldNames);
    }

    function registerSystem(bytes32 systemId, address systemAddr, bool publicAccess) external onlyOwner {
        _systems[systemId] = systemAddr;
        _systemPublic[systemId] = publicAccess;
        emit World_SystemRegistered(systemId, systemAddr, publicAccess);
    }

    function getSystemAddress(bytes32 systemId) external view returns (address) {
        return _systems[systemId];
    }

    function isTableRegistered(bytes32 tableId) external view returns (bool) {
        return _tables[tableId].registered;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Store (gated by access control)
    // ─────────────────────────────────────────────────────────────────────────

    function setRecord(
        bytes32 tableId,
        bytes32[] calldata key,
        bytes calldata staticData,
        bytes calldata dynamicData
    ) external {
        if (!_tables[tableId].registered) revert World_TableNotFound(tableId);
        if (!canWrite[tableId][msg.sender]) revert World_AccessDenied(tableId, msg.sender);

        bytes32 keyHash = _keyHash(key);
        _staticStore[tableId][keyHash] = staticData;
        _dynamicStore[tableId][keyHash] = dynamicData;
        _exists[tableId][keyHash] = true;
        emit Store_SetRecord(tableId, key, staticData, dynamicData);
    }

    function getRecord(bytes32 tableId, bytes32[] calldata key)
        external
        view
        returns (bytes memory staticData, bytes memory dynamicData)
    {
        if (!_tables[tableId].registered) revert World_TableNotFound(tableId);
        bytes32 keyHash = _keyHash(key);
        return (_staticStore[tableId][keyHash], _dynamicStore[tableId][keyHash]);
    }

    function deleteRecord(bytes32 tableId, bytes32[] calldata key) external {
        if (!_tables[tableId].registered) revert World_TableNotFound(tableId);
        if (!canWrite[tableId][msg.sender]) revert World_AccessDenied(tableId, msg.sender);

        bytes32 keyHash = _keyHash(key);
        delete _staticStore[tableId][keyHash];
        delete _dynamicStore[tableId][keyHash];
        _exists[tableId][keyHash] = false;
        emit Store_DeleteRecord(tableId, key);
    }

    function recordExists(bytes32 tableId, bytes32[] calldata key) external view returns (bool) {
        return _exists[tableId][_keyHash(key)];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // System-call routing — the redemption entry point
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Route a call to a registered system, appending the canonical sender.
     * @dev The system address is `call`ed (not delegatecall'd) with the resolved
     *      player appended as trailing 20 bytes (ERC-2771). Reverts bubble up
     *      unchanged so enforcer/system named errors surface to the relayer/SDK.
     */
    function call(bytes32 systemId, bytes calldata callData)
        external
        payable
        nonReentrant
        returns (bytes memory)
    {
        address systemAddr = _systems[systemId];
        if (systemAddr == address(0)) revert World_SystemNotFound(systemId);

        address sender = _resolveSender();
        // ERC-2771 trailing-bytes append: callData ++ sender(20 bytes)
        bytes memory payload = abi.encodePacked(callData, sender);

        (bool ok, bytes memory ret) = systemAddr.call{value: msg.value}(payload);
        if (!ok) {
            // bubble the revert reason / named custom error unchanged
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }

    /**
     * @dev Canonical-sender resolution. Only trust appended bytes from the
     *      trusted forwarder (the DelegationManager); otherwise use msg.sender.
     *      This is the anti-spoofing rule from Phase 01 §8.
     */
    function _resolveSender() internal view returns (address sender) {
        if (msg.sender == trustedForwarder && trustedForwarder != address(0) && msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    function _keyHash(bytes32[] calldata key) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(key));
    }
}
