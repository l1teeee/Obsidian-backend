export const editImageSchema = {
  body: {
    type: 'object',
    required: ['imageDataUrl', 'instruction'],
    properties: {
      imageDataUrl: { type: 'string', maxLength: 7_000_000 },  // base64 PNG (square, max ~5MB)
      instruction:  { type: 'string', minLength: 3, maxLength: 1000 },
    },
    additionalProperties: false,
  },
} as const;

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

export const analyzeImageSchema = {
  body: {
    type: 'object',
    required: ['imageUrls', 'platforms'],
    properties: {
      imageUrls: {
        type:     'array',
        items:    { type: 'string', maxLength: 5_000_000 },  // base64 data: or HTTPS URL
        minItems: 1,
        maxItems: 4,
      },
      platforms: {
        type:     'array',
        items:    { type: 'string', enum: ['meta', 'linkedin', 'youtube'] },
        minItems: 1,
      },
      workspaceId: { type: 'string' },
      currentHour: { type: 'integer', minimum: 0, maximum: 23 },
      weekday:     { type: 'string', maxLength: 20 },
    },
    additionalProperties: false,
  },
} as const;

export const carouselSlidesSchema = {
  body: {
    type: 'object',
    required: ['topic', 'count'],
    properties: {
      topic: { type: 'string', minLength: 3, maxLength: 300 },
      count: { type: 'integer', minimum: 2, maximum: 10 },
      style: { type: 'string', maxLength: 300 },
    },
    additionalProperties: false,
  },
} as const;

export const suggestTimeSchema = {
  body: {
    type: 'object',
    required: ['platforms'],
    properties: {
      caption:     { type: 'string', maxLength: 2200 },
      platforms: {
        type:     'array',
        items:    { type: 'string', enum: ['meta', 'linkedin', 'youtube'] },
        minItems: 1,
      },
      currentHour: { type: 'integer', minimum: 0, maximum: 23 },
      weekday:     { type: 'string', maxLength: 20 },
    },
    additionalProperties: false,
  },
} as const;
