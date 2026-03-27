export const generateImageSchema = {
  body: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', minLength: 3, maxLength: 1000 },
      size:   { type: 'string', enum: ['1024x1024', '1792x1024', '1024x1792'] },
    },
    additionalProperties: false,
  },
} as const;

export const inspireSchema = {
  body: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        minLength: 1,
        maxLength: 200,
      },
      platform: {
        type: 'string',
        enum: ['meta', 'linkedin', 'youtube'],
      },
      workspaceId: {
        type: 'string',
      },
      imageUrls: {
        type:     'array',
        items:    { type: 'string', maxLength: 5_000_000 },  // supports data: base64
        maxItems: 4,
      },
    },
    additionalProperties: false,
  },
} as const;

export const suggestTimeSchema = {
  body: {
    type: 'object',
    required: ['platforms'],
    properties: {
      caption:   { type: 'string', maxLength: 2200 },
      platforms: {
        type:     'array',
        items:    { type: 'string', enum: ['meta', 'linkedin', 'youtube'] },
        minItems: 1,
      },
    },
    additionalProperties: false,
  },
} as const;
