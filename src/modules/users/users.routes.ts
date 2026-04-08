import { Router } from 'express';
import { asyncHandler } from '../../middleware/async-handler';
import { requireAuth } from '../../middleware/require-auth';
import { createUserSchema, parseInput, updateUserSchema, updateUserStatusSchema, userIdParamSchema } from './users.schemas';
import * as usersService from './users.service';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    await usersService.listUsers(req, res);
  }),
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    req.body = parseInput(createUserSchema, req.body);
    await usersService.createUser(req, res);
  }),
);

usersRouter.patch(
  '/:publicId',
  asyncHandler(async (req, res) => {
    req.params = parseInput(userIdParamSchema, req.params);
    req.body = parseInput(updateUserSchema, req.body);
    await usersService.updateUser(req, res);
  }),
);

usersRouter.patch(
  '/:publicId/status',
  asyncHandler(async (req, res) => {
    req.params = parseInput(userIdParamSchema, req.params);
    req.body = parseInput(updateUserStatusSchema, req.body);
    await usersService.updateUserStatus(req, res);
  }),
);

