import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Exempts a route from the API key guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
