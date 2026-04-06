export const registerSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email', maxLength: 255 },
      password: { type: 'string', minLength: 8, maxLength: 72 },
    },
  },
};

export const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email:      { type: 'string', format: 'email' },
      password:   { type: 'string', minLength: 1 },
      rememberMe: { type: 'boolean' },
      force:      { type: 'boolean' },
    },
  },
};

export const verifyEmailSchema = {
  body: {
    type: 'object',
    required: ['email', 'code'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email' },
      code:  { type: 'string', minLength: 1, maxLength: 10 },
    },
  },
};

export const resendVerificationSchema = {
  body: {
    type: 'object',
    required: ['email'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email' },
    },
  },
};

// Refresh token is read from the httpOnly cookie — no body required.
export const refreshSchema = {};
