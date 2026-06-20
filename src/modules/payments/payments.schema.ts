export const confirmSubscriptionSchema = {
  body: {
    type: 'object',
    required: ['subscriptionId', 'planId'],
    additionalProperties: false,
    properties: {
      subscriptionId: { type: 'string', minLength: 1, maxLength: 100 },
      planId:         { type: 'string', enum: ['starter', 'pro', 'studio'] },
    },
  },
};