const settingsFields = {
  persona:             { type: 'string', maxLength: 1000 },
  brand_voice:         { type: 'string', maxLength: 2000 },
  target_audience:     { type: 'string', maxLength: 1000 },
  content_pillars:     { type: 'string', maxLength: 1000 },
  hashtag_strategy:    { type: 'string', maxLength: 1000 },
  example_posts:       { type: 'string', maxLength: 3000 },
  avoid:               { type: 'string', maxLength: 1000 },
  custom_instructions: { type: 'string', maxLength: 2000 },
} as const;

export const upsertAiSettingsSchema = {
  params: {
    type: 'object',
    required: ['workspaceId'],
    properties: { workspaceId: { type: 'string' } },
  },
  body: {
    type: 'object',
    properties: settingsFields,
    additionalProperties: false,
  },
} as const;

export const getAiSettingsSchema = {
  params: {
    type: 'object',
    required: ['workspaceId'],
    properties: { workspaceId: { type: 'string' } },
  },
} as const;
