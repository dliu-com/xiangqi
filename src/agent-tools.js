// Optional structured controls for browsers that implement the WebMCP proposal.
import { t } from './i18n.js';

export function registerGameTools(context, getState, move) {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools = [
    {
      name: 'get_xiangqi_game',
      title: t('查看当前棋局', 'Read the current game'),
      description: 'Read the shared Xiangqi position currently shown on the board.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => getState(),
    },
    {
      name: 'play_xiangqi_move',
      title: t('走一步象棋', 'Play a Xiangqi move'),
      description: 'Play and save one legal move in the shared game. Indices use the unflipped 9-by-10 board, starting at zero in the upper-left.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'integer', minimum: 0, maximum: 89 },
          to: { type: 'integer', minimum: 0, maximum: 89 },
          expectedRevision: { type: 'integer', minimum: 0 },
        },
        required: ['from', 'to', 'expectedRevision'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (!input || !Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from < 0 || input.from > 89 || input.to < 0 || input.to > 89 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
          throw new Error(t('落点或棋局版本无效。', 'Invalid point or game version.'));
        }
        return await move(input);
      },
    },
  ];
  for (const tool of tools) {
    try {
      Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(error => console.warn('Optional game tool unavailable:', error));
    } catch (error) { console.warn('Optional game tool unavailable:', error); }
  }
  return () => lifecycle.abort();
}
