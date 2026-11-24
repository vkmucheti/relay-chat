import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';

const bucket = process.env.S3_BUCKET;
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ROOT_USER,
    secretAccessKey: process.env.MINIO_ROOT_PASSWORD,
  },
});

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
} catch (error) {
  if (error.$metadata?.httpStatusCode !== 404) throw error;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
}
console.log('Private media bucket is ready');
