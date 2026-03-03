import { generateMonthlyInvoices } from '../modules/billing/billing.service.js';

export async function runMonthlyInvoicingJob(billingMonth?: string): Promise<void> {
  const result = await generateMonthlyInvoices({
    billingMonth
  });
  // eslint-disable-next-line no-console
  console.log('Monthly invoicing result:', result);
}

