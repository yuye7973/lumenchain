import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const runDMADMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: "debate-1",
    task: "mock",
    totalRounds: 2,
    convergenceScore: 0.812,
  })),
);

vi.mock("./dmad-debate.js", () => ({
  runDMAD: runDMADMock,
}));

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createDb(): Database.Database {
  return {
    prepare: vi.fn(),
  } as unknown as Database.Database;
}

let startCroner: typeof import("./croner.js").startCroner;
let runDailyDmad: typeof import("./croner.js").runDailyDmad;

describe("DMAD croner", () => {
  beforeAll(async () => {
    ({ startCroner, runDailyDmad } = await import("./croner.js"));
  });

  beforeEach(() => {
    runDMADMock.mockClear();
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
    vi.restoreAllMocks();
  });

  it("registers the daily DMAD schedule", () => {
    const scheduledTimeouts: number[] = [];
    const scheduledIntervals: number[] = [];

    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((fn: TimerHandler, delay?: number) => {
        scheduledTimeouts.push(Number(delay ?? 0));
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);

    vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: TimerHandler, delay?: number) => {
      scheduledIntervals.push(Number(delay ?? 0));
      return 2 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);

    startCroner(createDb(), "C:\\tmp\\evolution-state");

    expect(setTimeoutSpy).toHaveBeenCalledTimes(5);
    expect(scheduledTimeouts.length).toBe(5);
    expect(scheduledIntervals.length).toBe(2);
    expect(scheduledTimeouts.every((delay) => delay >= 0)).toBe(true);
  });

  it("uses recent failure patterns as the DMAD seed and skips during REM window", async () => {
    const tempRoot = await createTempDir("dmad-croner-");
    const stateDir = path.join(tempRoot, "a", "b", "c", "d");
    const learningStatePath = path.join(
      tempRoot,
      "reports",
      "hermes-agent",
      "state",
      "learning-state.json",
    );

    await fs.mkdir(path.dirname(learningStatePath), { recursive: true });
    await fs.writeFile(
      learningStatePath,
      JSON.stringify(
        {
          failure_patterns: [
            {
              summary: "API schema failed recently",
              recordedAt: "2026-06-04T01:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = await runDailyDmad(createDb(), stateDir, new Date("2026-06-04T05:15:00+08:00"));

    expect(runDMADMock).toHaveBeenCalledTimes(1);
    expect(runDMADMock).toHaveBeenCalledWith(
      expect.stringContaining("API schema failed recently"),
      expect.any(Object),
      expect.objectContaining({ maxRounds: 2, timeoutMs: 20_000 }),
    );
    expect(result).toEqual({
      task: "dmad_daily",
      ran: true,
      affected: 2,
    });

    runDMADMock.mockClear();

    const skipped = await runDailyDmad(
      createDb(),
      stateDir,
      new Date("2026-06-04T03:15:00+08:00"),
    );

    expect(runDMADMock).not.toHaveBeenCalled();
    expect(skipped).toEqual({
      task: "dmad_daily",
      ran: false,
    });
  });
});
