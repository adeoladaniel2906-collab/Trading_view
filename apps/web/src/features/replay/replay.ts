import type { Candle } from "@market/contracts";

export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface ReplaySession {
  /** Immutable snapshot of historical candles captured when replay starts. */
  readonly sourceCandles: readonly Candle[];
  /** Index of the last candle visible to replay calculations. */
  readonly cursorIndex: number;
  readonly isPlaying: boolean;
  readonly speed: ReplaySpeed;
}

export function createReplaySession(candles: readonly Candle[]): ReplaySession | null {
  if (candles.length < 2) return null;
  const snapshot = candles.map((candle) => ({ ...candle }));
  return {
    sourceCandles: snapshot,
    cursorIndex: 0,
    isPlaying: false,
    speed: 1,
  };
}

export function visibleReplayCandles(session: ReplaySession): readonly Candle[] {
  return session.sourceCandles.slice(0, session.cursorIndex + 1);
}

export function toggleReplay(session: ReplaySession): ReplaySession {
  if (session.isPlaying) return { ...session, isPlaying: false };
  if (session.cursorIndex >= session.sourceCandles.length - 1) {
    return { ...session, cursorIndex: 0, isPlaying: true };
  }
  return { ...session, isPlaying: true };
}

export function advanceReplay(session: ReplaySession): ReplaySession {
  if (!session.isPlaying) return session;
  const nextIndex = Math.min(session.cursorIndex + 1, session.sourceCandles.length - 1);
  return {
    ...session,
    cursorIndex: nextIndex,
    isPlaying: nextIndex < session.sourceCandles.length - 1,
  };
}

export function stepReplay(session: ReplaySession, direction: -1 | 1): ReplaySession {
  const cursorIndex = Math.max(
    0,
    Math.min(session.sourceCandles.length - 1, session.cursorIndex + direction),
  );
  return { ...session, cursorIndex, isPlaying: false };
}

export function seekReplay(session: ReplaySession, index: number): ReplaySession {
  if (!Number.isInteger(index)) throw new RangeError("Replay cursor must be an integer index");
  const cursorIndex = Math.max(0, Math.min(session.sourceCandles.length - 1, index));
  return { ...session, cursorIndex, isPlaying: false };
}

export function setReplaySpeed(session: ReplaySession, speed: ReplaySpeed): ReplaySession {
  if (!REPLAY_SPEEDS.includes(speed)) throw new RangeError("Replay speed is unsupported");
  return { ...session, speed };
}
