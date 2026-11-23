import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceReplay,
  createReplaySession,
  seekReplay,
  setReplaySpeed,
  stepReplay,
  toggleReplay,
  visibleReplayCandles,
} from "../src/features/replay/replay.js";

const candles = Array.from({ length: 5 }, (_, index) => ({
  time: 1_700_000_000 + index * 60,
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
}));

test("replay snapshots historical data and never exposes candles after its cursor", () => {
  const session = createReplaySession(candles);
  assert.ok(session);
  assert.deepEqual(visibleReplayCandles(session), candles.slice(0, 1));
  const advanced = advanceReplay(toggleReplay(session));
  assert.equal(advanced.cursorIndex, 1);
  assert.deepEqual(visibleReplayCandles(advanced), candles.slice(0, 2));
  assert.equal(visibleReplayCandles(advanced).at(-1)?.time, candles[1]?.time);
});

test("replay snapshot does not change when the live history array is later extended", () => {
  const session = createReplaySession(candles);
  assert.ok(session);
  const extended = [...candles, { time: 1_700_000_300, open: 105, high: 106, low: 104, close: 105 }];
  assert.equal(extended.length, 6);
  assert.equal(session.sourceCandles.length, 5);
});

test("playback stops exactly at the final candle and play from end restarts", () => {
  const session = createReplaySession(candles);
  assert.ok(session);
  let playing = toggleReplay(seekReplay(session, 3));
  playing = advanceReplay(playing);
  assert.equal(playing.cursorIndex, 4);
  assert.equal(playing.isPlaying, false);
  const restarted = toggleReplay(playing);
  assert.equal(restarted.cursorIndex, 0);
  assert.equal(restarted.isPlaying, true);
});

test("manual stepping and seeking clamp to available candles and pause playback", () => {
  const session = createReplaySession(candles);
  assert.ok(session);
  assert.equal(stepReplay(session, -1).cursorIndex, 0);
  assert.equal(stepReplay(session, 1).cursorIndex, 1);
  assert.equal(seekReplay(session, 999).cursorIndex, 4);
  assert.equal(seekReplay(session, -5).cursorIndex, 0);
  assert.throws(() => seekReplay(session, 1.5), /integer index/);
});

test("replay speed is restricted to supported deterministic intervals", () => {
  const session = createReplaySession(candles);
  assert.ok(session);
  assert.equal(setReplaySpeed(session, 4).speed, 4);
  assert.throws(() => setReplaySpeed(session, 3 as 1), /unsupported/);
});

test("replay cannot start without enough historical candles", () => {
  assert.equal(createReplaySession([]), null);
  assert.equal(createReplaySession(candles.slice(0, 1)), null);
});
