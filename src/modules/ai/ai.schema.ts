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
    required: ['topic'],
    properties: {
      topic: {
        type: 'string',
        minLength: 2,
        maxLength: 200,
      },
      platform: {
        type: 'string',
        enum: ['meta', 'linkedin', 'youtube'],
      },
      workspaceId: {
        type: 'string',
      },
    },
    additionalProperties: false,
  },
} as const;
