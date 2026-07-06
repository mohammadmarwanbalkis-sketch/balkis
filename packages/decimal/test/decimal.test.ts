import { defineCalculation, runCalculation, unwrap } from "@balkis/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Decimal, dec, decimalString } from "../src/index.js";

describe("parsing and formatting", () => {
  it("parses canonical strings and round-trips exactly", () => {
    for (const value of ["0", "1", "-1", "0.1", "-0.001", "123.450", "9007199254740993.5"]) {
      expect(Decimal.from(value).toString()).toBe(value);
    }
  });

  it("accepts safe-integer numbers and bigints, rejects fractional numbers", () => {
    expect(dec(42).toString()).toBe("42");
    expect(dec(10n ** 30n).toString()).toBe((10n ** 30n).toString());
    expect(() => dec(0.1)).toThrow(/safe integers/);
    expect(() => dec(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it("rejects non-canonical strings", () => {
    for (const bad of ["1e5", "1.", ".5", "1,000", "NaN", "0x10", ""]) {
      expect(() => Decimal.from(bad), `"${bad}"`).toThrow(RangeError);
    }
  });

  it("serializes to JSON as the canonical string", () => {
    expect(JSON.stringify({ price: dec("19.99") })).toBe('{"price":"19.99"}');
  });
});

describe("exact arithmetic", () => {
  it("fixes the classic float bug: 0.1 + 0.2 = 0.3", () => {
    expect(dec("0.1").add(dec("0.2")).toString()).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3); // floats remain broken; that's the point
  });

  it("addition/subtraction align scales exactly", () => {
    expect(dec("1.5").add(dec("2.25")).toString()).toBe("3.75");
    expect(dec("1").sub(dec("0.001")).toString()).toBe("0.999");
    expect(dec("-1.1").add(dec("1.1")).isZero()).toBe(true);
  });

  it("multiplication is exact; scales add", () => {
    const product = dec("1.005").mul(dec("100"));
    expect(product.toString()).toBe("100.500");
    expect(dec("0.001").mul(dec("0.001")).toString()).toBe("0.000001");
  });

  it("survives magnitudes far beyond float precision", () => {
    const big = dec("99999999999999999999999999.99");
    expect(big.add(dec("0.01")).toString()).toBe("100000000000000000000000000.00");
  });
});

describe("division and rounding", () => {
  it("divides at an explicit scale", () => {
    expect(dec("1").div(dec("3"), 4).toString()).toBe("0.3333");
    expect(dec("100").div(dec("7"), 2).toString()).toBe("14.29");
    expect(() => dec("1").div(dec("0"), 2)).toThrow(/zero/i);
  });

  it("half-even (banker's) rounds ties to the even neighbour", () => {
    expect(dec("2.5").round(0).toString()).toBe("2");
    expect(dec("3.5").round(0).toString()).toBe("4");
    expect(dec("-2.5").round(0).toString()).toBe("-2");
    expect(dec("0.125").round(2).toString()).toBe("0.12");
    expect(dec("0.135").round(2).toString()).toBe("0.14");
  });

  it("supports half-up, down, floor, ceil", () => {
    expect(dec("2.5").round(0, "half-up").toString()).toBe("3");
    expect(dec("-2.5").round(0, "half-up").toString()).toBe("-3");
    expect(dec("2.9").round(0, "down").toString()).toBe("2");
    expect(dec("-2.9").round(0, "down").toString()).toBe("-2");
    expect(dec("-2.1").round(0, "floor").toString()).toBe("-3");
    expect(dec("2.1").round(0, "ceil").toString()).toBe("3");
  });

  it("negative divisors round with correct signs", () => {
    expect(dec("1").div(dec("-3"), 2).toString()).toBe("-0.33");
    expect(dec("-1").div(dec("-3"), 2).toString()).toBe("0.33");
  });
});

describe("comparison", () => {
  it("compares by numeric value across scales", () => {
    expect(dec("1.50").eq(dec("1.5"))).toBe(true);
    expect(dec("2").gt(dec("1.999"))).toBe(true);
    expect(dec("-0.001").lt(Decimal.zero())).toBe(true);
    expect([dec("3"), dec("1.5"), dec("2")].sort((a, b) => a.cmp(b)).map(String)).toEqual([
      "1.5",
      "2",
      "3",
    ]);
  });
});

describe("integration with calculations", () => {
  it("decimal strings flow through schemas; math is exact end to end", async () => {
    const invoice = defineCalculation({
      id: "billing.invoice-total",
      version: "1.0.0",
      summary: "Sum of line items plus 11% VAT, exact to the cent (banker's rounding).",
      input: z.object({ lineItems: z.array(decimalString()).min(1) }),
      output: z.object({ subtotal: decimalString(), vat: decimalString(), total: decimalString() }),
      calculate: ({ input }) => {
        const subtotal = input.lineItems
          .map(Decimal.from)
          .reduce((sum, item) => sum.add(item), Decimal.zero(2));
        const vat = subtotal.mul(Decimal.from("0.11")).round(2);
        return {
          subtotal: subtotal.toString(),
          vat: vat.toString(),
          total: subtotal.add(vat).toString(),
        };
      },
    });

    const report = unwrap(
      await runCalculation(invoice, { lineItems: ["19.99", "0.01", "104.35"] }),
    );
    expect(report.value).toEqual({ subtotal: "124.35", vat: "13.68", total: "138.03" });
    // The audit trace carries exact strings, not float noise.
    expect(JSON.stringify(report.trace)).toContain('"124.35"');
  });
});
