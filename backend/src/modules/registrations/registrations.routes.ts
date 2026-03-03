import { Router } from 'express';
import { RegistrationPayloadSchema } from './registrations.types.js';
import { createRegistration } from './registrations.service.js';

export const registrationsRouter = Router();

registrationsRouter.post('/', async (req, res, next) => {
  try {
    const payload = RegistrationPayloadSchema.parse(req.body);
    const created = await createRegistration(payload);
    res.status(201).json({
      status: 'ok',
      data: created
    });
  } catch (error) {
    next(error);
  }
});

