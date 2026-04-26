export const createWorkspaceSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
};

export const updateWorkspaceSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
};

export const setPreferredChannelSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    required: ['channel'],
    additionalProperties: false,
    properties: {
      channel: { type: ['string', 'null'], enum: ['ig', 'fb', 'li', null] },
    },
  },
};
