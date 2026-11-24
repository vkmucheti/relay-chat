import { SetMetadata } from '@nestjs/common';
export const publicKey = Symbol('public endpoint');
export const Public = () => SetMetadata(publicKey, true);
