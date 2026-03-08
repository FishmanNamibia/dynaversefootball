import { Router } from 'express';
import {
  AutoCreateNeedsSchema,
  CreateFundingSourceSchema,
  CreateInventoryItemSchema,
  CreateNeedSchema,
  CreateProcurementRequestSchema,
  CreateStaffMemberSchema,
  CreateStaffPaymentSchema,
  ListNeedsSchema,
  ListProcurementSchema,
  ListStaffPaymentsSchema,
  ListWithLimitSchema,
  ReceiveFundingSchema,
  ReceiveProcurementRequestSchema,
  RecordStaffPaymentSchema,
  RecordStockMovementSchema,
  UpdateNeedSchema
} from './operations.types.js';
import {
  autoCreateNeedsFromStockGaps,
  createFundingSource,
  createInventoryItem,
  createNeed,
  createProcurementRequest,
  createStaffMember,
  createStaffPayment,
  getOperationsDashboard,
  getStaffPaymentSlipPdfBuffer,
  listFundingSources,
  listInventoryItems,
  listNeeds,
  listProcurementRequests,
  listStaffMembers,
  listStaffPayments,
  receiveFunding,
  receiveProcurementRequest,
  recordStaffPayment,
  recordStockMovement,
  updateNeed
} from './operations.service.js';

export const operationsRouter = Router();

operationsRouter.get('/dashboard', async (_req, res, next) => {
  try {
    const data = await getOperationsDashboard();
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/inventory/items', async (req, res, next) => {
  try {
    const parsed = ListWithLimitSchema.parse({ limit: req.query.limit });
    const data = await listInventoryItems(parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/inventory/items', async (req, res, next) => {
  try {
    const payload = CreateInventoryItemSchema.parse(req.body ?? {});
    const data = await createInventoryItem(payload);
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/inventory/movements', async (req, res, next) => {
  try {
    const payload = RecordStockMovementSchema.parse(req.body ?? {});
    const data = await recordStockMovement(payload);
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/inventory/auto-needs', async (req, res, next) => {
  try {
    const payload = AutoCreateNeedsSchema.parse(req.body ?? {});
    const data = await autoCreateNeedsFromStockGaps(payload.createdBy ?? req.authUser?.username);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/needs', async (req, res, next) => {
  try {
    const parsed = ListNeedsSchema.parse({
      status: req.query.status,
      limit: req.query.limit
    });
    const data = await listNeeds(parsed.status, parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/needs', async (req, res, next) => {
  try {
    const payload = CreateNeedSchema.parse(req.body ?? {});
    const data = await createNeed({
      ...payload,
      createdBy: payload.createdBy ?? req.authUser?.username
    });
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.patch('/needs/:needId', async (req, res, next) => {
  try {
    const payload = UpdateNeedSchema.parse(req.body ?? {});
    await updateNeed(req.params.needId, payload);
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/procurement', async (req, res, next) => {
  try {
    const parsed = ListProcurementSchema.parse({
      status: req.query.status,
      limit: req.query.limit
    });
    const data = await listProcurementRequests(parsed.status, parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/procurement', async (req, res, next) => {
  try {
    const payload = CreateProcurementRequestSchema.parse(req.body ?? {});
    const data = await createProcurementRequest({
      ...payload,
      requestedBy: payload.requestedBy ?? req.authUser?.username
    });
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/procurement/:requestId/receive', async (req, res, next) => {
  try {
    const payload = ReceiveProcurementRequestSchema.parse(req.body ?? {});
    const data = await receiveProcurementRequest(req.params.requestId, {
      ...payload,
      createdBy: payload.createdBy ?? req.authUser?.username
    });
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/funding/sources', async (req, res, next) => {
  try {
    const parsed = ListWithLimitSchema.parse({ limit: req.query.limit });
    const data = await listFundingSources(parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/funding/sources', async (req, res, next) => {
  try {
    const payload = CreateFundingSourceSchema.parse(req.body ?? {});
    const data = await createFundingSource(payload);
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/funding/sources/:sourceId/receive', async (req, res, next) => {
  try {
    const payload = ReceiveFundingSchema.parse(req.body ?? {});
    const data = await receiveFunding(req.params.sourceId, {
      ...payload,
      recordedBy: payload.recordedBy ?? req.authUser?.username
    });
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/staff/members', async (req, res, next) => {
  try {
    const parsed = ListWithLimitSchema.parse({ limit: req.query.limit });
    const data = await listStaffMembers(parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/staff/members', async (req, res, next) => {
  try {
    const payload = CreateStaffMemberSchema.parse(req.body ?? {});
    const data = await createStaffMember(payload);
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/staff/payments', async (req, res, next) => {
  try {
    const parsed = ListStaffPaymentsSchema.parse({
      periodMonth: req.query.periodMonth,
      status: req.query.status,
      limit: req.query.limit
    });
    const data = await listStaffPayments(parsed);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/staff/payments', async (req, res, next) => {
  try {
    const payload = CreateStaffPaymentSchema.parse(req.body ?? {});
    const data = await createStaffPayment({
      ...payload,
      createdBy: payload.createdBy ?? req.authUser?.username
    });
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/staff/payments/:paymentId/slip.pdf', async (req, res, next) => {
  try {
    const pdf = await getStaffPaymentSlipPdfBuffer(req.params.paymentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="salary-slip-${req.params.paymentId}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/staff/payments/:paymentId/record', async (req, res, next) => {
  try {
    const payload = RecordStaffPaymentSchema.parse(req.body ?? {});
    const data = await recordStaffPayment(req.params.paymentId, payload);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});
