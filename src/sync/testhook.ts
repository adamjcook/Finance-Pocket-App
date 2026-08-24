import { decodeFrames } from './codec';
import { applyPayload, currentFrames, type ApplyResult } from './apply';
import { stateHash } from '../logic/merge';
import { getStore } from '../model/store';
import type { SyncPayload } from '../model/types';

/**
 * Frame-level sync API on window, bypassing only the camera/canvas optics.
 * Used by the Playwright two-device test to pipe frames between browser
 * contexts; everything else (codec, merge, persistence) is the real path.
 */
declare global {
  interface Window {
    __syncTest: {
      exportFrames(): Promise<string[]>;
      importFrames(frames: string[]): Promise<ApplyResult>;
      importPayload(payload: SyncPayload): Promise<ApplyResult>;
      stateHash(): Promise<string>;
    };
  }
}

window.__syncTest = {
  exportFrames: () => currentFrames(),
  importFrames: async (frames) => applyPayload(await decodeFrames(frames)),
  importPayload: (payload) => applyPayload(payload),
  stateHash: () => stateHash(getStore().state),
};
