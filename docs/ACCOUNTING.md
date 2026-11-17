# Accounting rules — source review notes

## What is visible in the supplied files
- The workbook contains 56 sheets. Several month sheets are named by month (for example Jan, Feb, Mar, Apr, May, Jun, Jul, Aug).
- Month sheets use a day-number header and member entries arranged as paired rows: `Day` and `Night`.
- Daily cells contain fractional quantities (examples visible include 0, 0.5, 1, 1.5, 2, 2.5, 3; the CSV also contains 0.75 and 1.25).
- Summary columns include row/month totals and columns labelled `Due or Return`.
- The CSV supplied is an August-style extract with the same Day/Night member layout.

## What is NOT safe to infer yet
The spreadsheet structure alone does not establish:
- whether the daily cell value is a meal count, a meal weight, or a multiplier in all historical months;
- the exact formula behind each member's billed amount;
- whether deposits are recorded in a separate sheet, or whether `Due or Return` is a balance after some deductions;
- how shared market, utility, rent, guest meals, advance payments, corrections and refunds are allocated;
- whether blank cells mean zero, not applicable, or not yet entered.

## Safe implementation rule
MessMate stores each daily Day/Night value as a decimal quantity. It does not auto-create financial charges from the quantity until the treasurer confirms the formula. The dashboard currently shows recorded meal quantities and recorded deposits/expenses separately. The displayed cash balance is deposits minus expenses; it is not a final member settlement.

## Required verification before live settlement
1. Compare at least one fully closed month against the spreadsheet.
2. Confirm the meaning of `Due or Return` with the treasurer.
3. Confirm the meal-rate formula and rounding policy.
4. Confirm how deposits and individual purchases are represented.
5. Test edge cases: absent member, guest meal, late correction, refund, negative balance, month boundary.
