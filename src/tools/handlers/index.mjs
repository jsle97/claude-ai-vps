// file: src/tools/handlers/index.mjs
import { sessionHandlers } from './session.mjs';
import { execHandlers } from './exec.mjs';
import { readHandlers } from './read.mjs';
import { writeHandlers } from './write.mjs';
import { transferHandlers } from './transfer.mjs';

export const handlers = {
 ...sessionHandlers,
 ...execHandlers,
 ...readHandlers,
 ...writeHandlers,
 ...transferHandlers
};
