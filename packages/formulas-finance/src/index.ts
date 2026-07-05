/**
 * @balkis/formulas-finance — financial formulas as pure Balkis calculation definitions.
 *
 * Conventions: rates are decimals per period (0.05 = 5%); cash flows are indexed from
 * t = 0 with outflows negative; values are unrounded doubles (currency rounding is a
 * presentation concern). Register individual calculations or the whole library via
 * `financeCalculations`.
 */

import type { AnyCalculation } from "@balkis/core";
import { decliningBalanceDepreciation, straightLineDepreciation } from "./depreciation.js";
import { amortizationSchedule, loanPayment } from "./loan.js";
import { irr, npv } from "./npv.js";
import { returnOnInvestment } from "./roi.js";
import { compoundInterest, futureValue, presentValue } from "./tvm.js";

export { decliningBalanceDepreciation, straightLineDepreciation } from "./depreciation.js";
export { amortizationSchedule, loanPayment } from "./loan.js";
export { internalRateOfReturn, irr, netPresentValue, npv } from "./npv.js";
export { returnOnInvestment } from "./roi.js";
export { compoundInterest, futureValue, presentValue } from "./tvm.js";

/** Every calculation in this library, for bulk registration: `registry.registerAll(financeCalculations)`. */
export const financeCalculations: readonly AnyCalculation[] = Object.freeze([
  futureValue,
  compoundInterest,
  presentValue,
  npv,
  irr,
  loanPayment,
  amortizationSchedule,
  straightLineDepreciation,
  decliningBalanceDepreciation,
  returnOnInvestment,
]);
