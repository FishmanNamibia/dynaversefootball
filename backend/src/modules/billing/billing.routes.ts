import { Router } from 'express';
import {
  createCustomFeeInvoice,
  generateMonthlyInvoices,
  getInvoiceDetails,
  getInvoicePdfBuffer,
  getReceiptPdfBuffer,
  listInvoices,
  listOutstandingMonthlyFees,
  markOverdueInvoices,
  recordPayment,
  sendInvoiceToGuardian,
  sendOutstandingMonthlyFeeReminders
} from './billing.service.js';
import {
  CreateCustomFeeInvoiceSchema,
  GenerateMonthlyInvoicesSchema,
  RecordPaymentSchema,
  SendInvoiceSchema,
  SendOutstandingRemindersSchema
} from './billing.types.js';
import { HttpError } from '../../utils/httpError.js';

export const billingRouter = Router();

billingRouter.get('/invoices', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const data = await listInvoices(status, Number.isFinite(limit) ? limit : 50);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

billingRouter.get('/invoices/:invoiceId', async (req, res, next) => {
  try {
    const data = await getInvoiceDetails(req.params.invoiceId);
    if (!data) {
      throw new HttpError(404, 'Invoice not found');
    }
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

billingRouter.get('/invoices/:invoiceId/pdf', async (req, res, next) => {
  try {
    const pdf = await getInvoicePdfBuffer(req.params.invoiceId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${req.params.invoiceId}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

billingRouter.post('/invoices/:invoiceId/send', async (req, res, next) => {
  try {
    const payload = SendInvoiceSchema.parse(req.body);
    const data = await sendInvoiceToGuardian(req.params.invoiceId, payload);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

billingRouter.post('/payments', async (req, res, next) => {
  try {
    const payload = RecordPaymentSchema.parse(req.body);
    const data = await recordPayment(payload);
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

billingRouter.get('/payments/:paymentId/receipt.pdf', async (req, res, next) => {
  try {
    const pdf = await getReceiptPdfBuffer(req.params.paymentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${req.params.paymentId}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

billingRouter.post('/fees/custom-invoice', async (req, res, next) => {
  try {
    const payload = CreateCustomFeeInvoiceSchema.parse(req.body);
    const data = await createCustomFeeInvoice(payload);
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

billingRouter.get('/fees/outstanding-monthly', async (req, res, next) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 200;
    const data = await listOutstandingMonthlyFees(Number.isFinite(limit) ? limit : 200);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

billingRouter.post('/fees/outstanding-monthly/remind', async (req, res, next) => {
  try {
    const payload = SendOutstandingRemindersSchema.parse(req.body ?? {});
    const data = await sendOutstandingMonthlyFeeReminders(payload);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

billingRouter.post('/jobs/monthly-invoices', async (req, res, next) => {
  try {
    const payload = GenerateMonthlyInvoicesSchema.parse(req.body ?? {});
    const data = await generateMonthlyInvoices(payload);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

billingRouter.post('/jobs/mark-overdue', async (_req, res, next) => {
  try {
    const updated = await markOverdueInvoices();
    res.json({
      status: 'ok',
      data: { updated }
    });
  } catch (error) {
    next(error);
  }
});

billingRouter.post('/jobs/outstanding-reminders', async (req, res, next) => {
  try {
    const payload = SendOutstandingRemindersSchema.parse(req.body ?? {});
    const data = await sendOutstandingMonthlyFeeReminders(payload);
    res.json({
      status: 'ok',
      data
    });
  } catch (error) {
    next(error);
  }
});
