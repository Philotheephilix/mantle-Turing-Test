// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title Nexus minimal ERC-7710 delegation interfaces
 * @notice These are MINIMAL LOCAL interfaces that match the MetaMask Delegation
 *         Framework (ERC-7710) signatures. We define them locally rather than
 *         vendoring the full framework so the package compiles deterministically
 *         and stays Base-only and small. They are *signature-compatible* with the
 *         canonical framework: enforcers written against `ICaveatEnforcer` here
 *         will be callable by the real on-chain `DelegationManager` at runtime.
 *
 * @dev    LIVE INTEGRATION NOTE / REDEMPTION RISK:
 *         On Base and Base-Sepolia the CANONICAL deployed MetaMask
 *         `DelegationManager` is used at runtime — we do NOT deploy our own. The
 *         address below is a placeholder constant to be filled from MetaMask's
 *         published deployments.
 *
 *         TODO(base-deploy): set DELEGATION_MANAGER to the canonical MetaMask
 *         Delegation Framework `DelegationManager` address on Base mainnet, and a
 *         Base-Sepolia variant for testnet, sourced from:
 *         https://docs.metamask.io/delegation-toolkit/ (deployments registry).
 */

/// @dev ERC-7579 execution mode code. The DelegationManager passes this through
///      to enforcer hooks. We model it as an opaque bytes32 (matches the
///      framework's `ModeCode` user-defined value type wrapping a bytes32).
type ModeCode is bytes32;

/// @notice A single caveat: an enforcer contract plus its encoded terms/args.
/// @dev Matches ERC-7710 `Caveat { address enforcer; bytes terms; bytes args; }`.
struct Caveat {
    address enforcer;
    bytes terms;
    bytes args;
}

/// @notice A signed delegation from `delegator` to `delegate`, gated by caveats.
/// @dev Matches the framework `Delegation` struct field-for-field.
struct Delegation {
    address delegate;
    address delegator;
    bytes32 authority;
    Caveat[] caveats;
    uint256 salt;
    bytes signature;
}

/**
 * @notice The caveat-enforcer interface every Nexus enforcer implements.
 * @dev Signatures match the MetaMask Delegation Framework `ICaveatEnforcer`.
 *      The DelegationManager calls `beforeHook` before executing the delegated
 *      action and `afterHook` after. A revert in either aborts the redemption.
 */
interface ICaveatEnforcer {
    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        ModeCode mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external;

    function afterHook(
        bytes calldata terms,
        bytes calldata args,
        ModeCode mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external;
}

/**
 * @notice Minimal `DelegationManager` redemption surface (ERC-7710).
 * @dev The canonical MetaMask DelegationManager implements this. The relayer
 *      (Phase 04) calls `redeemDelegations` to redeem a player's delegation; the
 *      manager runs each caveat's `beforeHook`/`afterHook` around the execution.
 */
interface IDelegationManager {
    function redeemDelegations(
        bytes[] calldata permissionContexts,
        ModeCode[] calldata modes,
        bytes[] calldata executionCallDatas
    ) external;
}

/// @notice Canonical deployment pointers for the live redemption integration.
library DelegationFramework {
    // TODO(base-deploy): fill from MetaMask's published Base deployments.
    address internal constant DELEGATION_MANAGER = address(0);
}
