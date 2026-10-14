import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import {
  formatScheduleDate,
  getNextSaturdayDate,
  isValidDateString,
  parseDateResponse,
  timezoneToUtc,
} from "./date.js";

/**
 * Schedule dates in the profile's timezone (default profile: Europe/Rome,
 * i.e. CET in winter, CEST in summer). Jest runs with TZ=America/Los_Angeles,
 * so these tests also prove the result does not depend on the machine's TZ.
 */

describe("parsing CET / CEST (European) dates", () => {
  it("accepts CEST (4-letter code, was rejected before)", () => {
    expect(isValidDateString("10/18/2026 06:20 PM CEST")).toBe(true);
    expect(timezoneToUtc("10/18/2026 06:20 PM CEST")?.toISOString()).toBe(
      "2026-10-18T16:20:00.000Z",
    );
  });

  it("accepts CET in winter", () => {
    expect(timezoneToUtc("12/19/2026 05:20 PM CET")?.toISOString()).toBe(
      "2026-12-19T16:20:00.000Z",
    );
  });

  it("'CET' typed in summer means Rome wall-clock time (no 1h surprise)", () => {
    expect(timezoneToUtc("10/18/2026 06:20 PM CET")?.toISOString()).toBe(
      "2026-10-18T16:20:00.000Z",
    );
  });

  it("accepts any IANA zone name", () => {
    expect(
      timezoneToUtc("10/18/2026 06:20 PM Europe/Rome")?.toISOString(),
    ).toBe("2026-10-18T16:20:00.000Z");
    expect(isValidDateString("10/18/2026 06:20 PM Europe/Rome")).toBe(true);
  });

  it("parseDateResponse handles CEST and still handles priorities", () => {
    expect(
      (parseDateResponse("10/18/2026 06:20 PM CEST") as Date).toISOString(),
    ).toBe("2026-10-18T16:20:00.000Z");
    expect(parseDateResponse("P1")).toBe("p1");
  });

  it("still parses PST (legacy profiles)", () => {
    expect(timezoneToUtc("12/13/2024 02:30 PM PST")?.toISOString()).toBe(
      "2024-12-13T22:30:00.000Z",
    );
  });
});

describe("formatScheduleDate", () => {
  it("shows CEST in summer and CET in winter for Europe/Rome", () => {
    expect(
      formatScheduleDate(new Date("2026-10-18T16:20:00Z"), "Europe/Rome"),
    ).toBe("10/18/2026 06:20 PM CEST");
    expect(
      formatScheduleDate(new Date("2026-12-19T16:20:00Z"), "Europe/Rome"),
    ).toBe("12/19/2026 05:20 PM CET");
  });

  it("round-trips: what the inbox shows can be submitted back unchanged", () => {
    const d = new Date("2026-10-18T16:20:00Z");
    const shown = formatScheduleDate(d, "Europe/Rome");
    expect((parseDateResponse(shown) as Date).toISOString()).toBe(
      d.toISOString(),
    );
  });

  it("falls back to the IANA name when the zone has no abbreviation", () => {
    const shown = formatScheduleDate(
      new Date("2026-10-18T16:20:00Z"),
      "Asia/Tehran",
    );
    expect(shown).toBe("10/18/2026 07:50 PM Asia/Tehran");
    expect((parseDateResponse(shown) as Date).toISOString()).toBe(
      "2026-10-18T16:20:00.000Z",
    );
  });
});

describe("getNextSaturdayDate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Wednesday 14 Oct 2026, 17:00 in Rome
    jest.setSystemTime(new Date("2026-10-14T15:00:00Z"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns next Saturday at the given wall-clock time in the zone", () => {
    expect(getNextSaturdayDate(8, 10, "Europe/Rome").toISOString()).toBe(
      "2026-10-17T06:10:00.000Z",
    );
    expect(
      formatScheduleDate(
        getNextSaturdayDate(8, 10, "Europe/Rome"),
        "Europe/Rome",
      ),
    ).toBe("10/17/2026 08:10 AM CEST");
  });

  it("works for Pacific too (langchain profile)", () => {
    expect(getNextSaturdayDate(8, 0, "America/Los_Angeles").toISOString()).toBe(
      "2026-10-17T15:00:00.000Z",
    );
  });
});
