import { CATEGORIES } from '@/shared/constants';

/**
 * Structured-output schemas passed to `responseConstraint`. Chrome constrains
 * decoding to these, which is what makes offset mapping reliable enough to
 * underline text without a server-side parser.
 */

export const issuesSchema = (categories: readonly string[]) =>
  ({
    type: 'object',
    additionalProperties: false,
    required: ['issues'],
    properties: {
      issues: {
        type: 'array',
        maxItems: 24,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sentence', 'original', 'replacement', 'category', 'message'],
          properties: {
            sentence: { type: 'integer', minimum: 0 },
            original: { type: 'string', minLength: 1 },
            replacement: { type: 'string' },
            category: { type: 'string', enum: [...categories] },
            message: { type: 'string', maxLength: 90 },
            explanation: { type: 'string', maxLength: 220 },
          },
        },
      },
    },
  }) as const;

export const ALL_ISSUE_CATEGORIES = [...CATEGORIES];

export const TONE_LABELS = [
  'formal', 'informal', 'friendly', 'confident', 'tentative', 'optimistic',
  'urgent', 'analytical', 'curious', 'appreciative', 'direct', 'diplomatic',
  'concerned', 'critical', 'neutral', 'persuasive', 'empathetic', 'enthusiastic',
] as const;

export const TONE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tones'],
  properties: {
    tones: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'confidence'],
        properties: {
          label: { type: 'string', enum: [...TONE_LABELS] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

export const TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string' } },
} as const;

export const SYNONYMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['words'],
  properties: {
    words: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 40 } },
  },
} as const;
