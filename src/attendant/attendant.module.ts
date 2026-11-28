import { Module } from '@nestjs/common';
import { AttendantController } from './attendant.controller.js';

@Module({ controllers: [AttendantController] })
export class AttendantModule {}
