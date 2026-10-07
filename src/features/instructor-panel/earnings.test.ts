import { describe, expect, it } from "vitest"

import { workshopEarnings, type EarningsInput } from "./earnings"

const base: EarningsInput = {
  cancelled: false,
  closedFee: null,
  contract: { feeType: "fixed", feeAmount: 500_000 },
  participants: 0,
  advancePaid: 0,
  advanceForCosts: 0,
  payments: 0,
}

describe("workshopEarnings", () => {
  it("a fixed fee, nothing paid yet: all of it is still to come", () => {
    expect(workshopEarnings(base)).toEqual({ fee: 500_000, received: 0, owed: 500_000, toReturn: 0 })
  })

  it("a fee per participant counts the participants", () => {
    const e = workshopEarnings({ ...base, contract: { feeType: "per_participant", feeAmount: 50_000 }, participants: 3 })
    expect(e).toEqual({ fee: 150_000, received: 0, owed: 150_000, toReturn: 0 })
  })

  it("the advance counts as received, except the part that went to workshop costs", () => {
    const e = workshopEarnings({ ...base, advancePaid: 100_000, advanceForCosts: 30_000 })
    expect(e).toEqual({ fee: 500_000, received: 70_000, owed: 430_000, toReturn: 0 })
  })

  it("after closing: the booked fee, and the payments since", () => {
    const e = workshopEarnings({
      ...base,
      closedFee: 450_000, // e.g. the per-participant fee booked at closing
      contract: { feeType: "per_participant", feeAmount: 50_000 },
      participants: 12, // ignored once the fee is booked
      advancePaid: 100_000,
      payments: 350_000,
    })
    expect(e).toEqual({ fee: 450_000, received: 450_000, owed: 0, toReturn: 0 })
  })

  it("a cancelled workshop pays no fee; an advance not spent on costs is to be returned", () => {
    const e = workshopEarnings({ ...base, cancelled: true, advancePaid: 80_000, advanceForCosts: 20_000 })
    expect(e).toEqual({ fee: 0, received: 60_000, owed: 0, toReturn: 60_000 })
  })
})
