import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { models } from '../database/model-names.js';
import { UsersModule } from '../users/users.module.js';
import { contactSchema } from './contact.schema.js';
import { ContactsService } from './contacts.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: models.contact, schema: contactSchema }]),
    UsersModule,
  ],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
