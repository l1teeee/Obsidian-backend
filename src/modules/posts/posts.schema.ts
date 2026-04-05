const platformEnum   = { type: 'string', enum: ['meta', 'linkedin', 'youtube', 'facebook', 'instagram'] };
const postTypeEnum   = { type: 'string', enum: ['post', 'reel', 'story', 'video', 'carousel'] };
const statusEnum     = { type: 'string', enum: ['draft', 'scheduled', 'published', 'inactive', 'deleted'] };
const mediaUrlsSchema = { type: 'array', items: { type: 'string', format: 'uri' } };
const idParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
};

export const getPostsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      platform: platformEnum,
      status:   statusEnum,
      page:  { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
  },
};

export const getPostByIdSchema = {
  params: idParam,
};

export const createPostSchema = {
  body: {
    type: 'object',
    required: ['platform'],
    additionalProperties: false,
    properties: {
      platform:     platformEnum,
      post_type:    postTypeEnum,
      caption:      { type: 'string', maxLength: 65536 },
      media_urls:   mediaUrlsSchema,
      scheduled_at: { type: 'string', format: 'date-time' },
      status:       statusEnum,
    },
  },
};

export const updatePostSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      platform:     platformEnum,
      post_type:    postTypeEnum,
      caption:      { type: 'string', maxLength: 65536 },
      media_urls:   mediaUrlsSchema,
      permalink:    { type: 'string', maxLength: 500 },
      scheduled_at: { type: 'string', format: 'date-time' },
      published_at: { type: 'string', format: 'date-time' },
      status:       statusEnum,
    },
  },
};

export const deletePostSchema = {
  params: idParam,
};
