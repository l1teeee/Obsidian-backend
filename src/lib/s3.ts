import { S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';

// The AWS SDK automatically reads AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
// from process.env — no need to pass them explicitly here.
export const s3 = new S3Client({ region: env.AWS_REGION });

export const S3_BUCKET     = env.S3_BUCKET;
export const S3_PUBLIC_URL = env.S3_PUBLIC_URL.replace(/\/$/, '');
