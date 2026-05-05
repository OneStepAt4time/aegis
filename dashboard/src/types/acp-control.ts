/**
 * types/acp-control.ts — Types for ACP control actions.
 *
 * Mirrors the backend AcpControlActionType from src/services/acp/types.ts.
 * Used by the dashboard control client and session hooks.
 */

/** Control action types that can be sent to a session. */
export type AcpControlActionType =
  | 'prompt'
  | 'approve'
  | 'reject'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'driver_transfer'
  | 'intervene'
  | 'close';

/** Session states relevant to control actions. */
export type AcpSessionControlState =
  | 'starting'
  | 'ready'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'intervening'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'disconnected'
  | 'recovering';

/** Which control actions are available for a given session state. */
export interface ControlActionAvailability {
  canPause: boolean;
  canResume: boolean;
  canIntervene: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  canTransferDriver: boolean;
  canClose: boolean;
}

/**
 * Derive available control actions from session state.
 */
export function deriveControlAvailability(
  state: AcpSessionControlState,
  isDriver: boolean,
): ControlActionAvailability {
  switch (state) {
    case 'running':
      return {
        canPause: isDriver,
        canResume: false,
        canIntervene: false,
        canApprove: false,
        canReject: false,
        canCancel: isDriver,
        canTransferDriver: isDriver,
        canClose: isDriver,
      };
    case 'awaiting_approval':
      return {
        canPause: false,
        canResume: false,
        canIntervene: false,
        canApprove: isDriver,
        canReject: isDriver,
        canCancel: isDriver,
        canTransferDriver: isDriver,
        canClose: isDriver,
      };
    case 'paused':
      return {
        canPause: false,
        canResume: isDriver,
        canIntervene: isDriver,
        canApprove: false,
        canReject: false,
        canCancel: isDriver,
        canTransferDriver: isDriver,
        canClose: isDriver,
      };
    case 'intervening':
      return {
        canPause: false,
        canResume: isDriver,
        canIntervene: false,
        canApprove: false,
        canReject: false,
        canCancel: isDriver,
        canTransferDriver: isDriver,
        canClose: isDriver,
      };
    default:
      return {
        canPause: false,
        canResume: false,
        canIntervene: false,
        canApprove: false,
        canReject: false,
        canCancel: false,
        canTransferDriver: false,
        canClose: false,
      };
  }
}
