import { Router } from 'express';
import {
  buildFinancialTransparencyCsv,
  buildFinancialTransparencyPdf,
  createManualExpenseEntry,
  createManualIncomeEntry,
  getFinancialTransparencyReport
} from './reports.service.js';
import {
  CreateManualExpenseEntrySchema,
  CreateManualIncomeEntrySchema,
  FinanceTransparencyQuerySchema
} from './reports.types.js';

export const reportsRouter = Router();

reportsRouter.get('/finance/transparency', async (req, res, next) => {
  try {
    const query = FinanceTransparencyQuerySchema.parse({
      from: req.query.from,
      to: req.query.to,
      sourceId: req.query.sourceId,
      limit: req.query.limit
    });
    const data = await getFinancialTransparencyReport(query);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/finance/transparency.csv', async (req, res, next) => {
  try {
    const query = FinanceTransparencyQuerySchema.parse({
      from: req.query.from,
      to: req.query.to,
      sourceId: req.query.sourceId,
      limit: req.query.limit
    });
    const { filename, csv } = await buildFinancialTransparencyCsv(query);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/finance/transparency.pdf', async (req, res, next) => {
  try {
    const query = FinanceTransparencyQuerySchema.parse({
      from: req.query.from,
      to: req.query.to,
      sourceId: req.query.sourceId,
      limit: req.query.limit
    });
    const { filename, pdf } = await buildFinancialTransparencyPdf(query);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

reportsRouter.post('/finance/income', async (req, res, next) => {
  try {
    const payload = CreateManualIncomeEntrySchema.parse(req.body ?? {});
    const data = await createManualIncomeEntry(payload);
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

reportsRouter.post('/finance/expenses', async (req, res, next) => {
  try {
    const payload = CreateManualExpenseEntrySchema.parse(req.body ?? {});
    const data = await createManualExpenseEntry(payload);
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});
