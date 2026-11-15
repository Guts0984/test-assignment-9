import { type Order, LIMITS } from '@app/shared';
import { parseMoneyInput } from '@/shared/lib/money';

export type PaymentInput = {
  method: 'cash' | 'card';
  amountText: string;
  tenderedText: string;
};

export type PaymentProblems = {
  amount?: 'invalid' | 'zero' | 'tooMuch';
  tendered?: 'invalid' | 'low';
};

export type PaymentDraft = {
  amount: number | null;
  tendered: number | null;
  /** Change to hand back (cash only; null while the inputs are incomplete). */
  change: number | null;
  problems: PaymentProblems;
  valid: boolean;
};

/**
 * Turns what the cashier typed into a checked payment. Pure and exhaustively testable: the same
 * rules as the server (amount > 0, not above what remains, cash must cover the amount).
 */
export const evaluatePayment = (
  input: PaymentInput,
  order: Pick<Order, 'remaining'>,
): PaymentDraft => {
  const problems: PaymentProblems = {};
  const amount = parseMoneyInput(input.amountText);
  if (amount === null) problems.amount = 'invalid';
  else if (amount === 0) problems.amount = 'zero';
  else if (amount > order.remaining || amount > LIMITS.maxKopecks) problems.amount = 'tooMuch';

  let tendered: number | null = null;
  let change: number | null = null;
  if (input.method === 'cash') {
    tendered = parseMoneyInput(input.tenderedText);
    if (tendered === null || tendered > LIMITS.maxKopecks) problems.tendered = 'invalid';
    else if (amount !== null && tendered < amount) problems.tendered = 'low';
    else if (amount !== null && !problems.amount) change = tendered - amount;
  }
  return {
    amount: problems.amount ? null : amount,
    tendered: input.method === 'cash' ? tendered : null,
    change,
    problems,
    valid: Object.keys(problems).length === 0,
  };
};
