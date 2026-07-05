export const confirmSubscriptionSchema = {
  body: {
    type: 'object',
    required: ['subscriptionId'],
    additionalProperties: false,
    properties: {
      subscriptionId: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
};
